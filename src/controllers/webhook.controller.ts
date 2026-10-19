import { Request, Response, NextFunction } from "express";
import { ITelephonyService } from "../services/interfaces/telephony.service.interface";
import { ICallRepository } from "../services/interfaces/call.repository.interface";
import { IDeduplicationService } from "../services/interfaces/deduplication.service.interface";
import { ICrmRepository } from "../services/crm.repository";
import { FreJunCallFlowRequest } from "../types/frejun.types";
import { Logger } from "../utils/logger";

export class WebhookController {
  private telephonyService: ITelephonyService;
  private callRepository: ICallRepository;
  private deduplicationService: IDeduplicationService;
  private crmRepository?: ICrmRepository;
  private logger = new Logger("WebhookController");

  constructor(
    telephonyService: ITelephonyService,
    callRepository: ICallRepository,
    deduplicationService: IDeduplicationService,
    crmRepository?: ICrmRepository
  ) {
    this.telephonyService = telephonyService;
    this.callRepository = callRepository;
    this.deduplicationService = deduplicationService;
    this.crmRepository = crmRepository;
  }

  /**
   * POST /api/teler/flow
   * Handles Call Flow request from FreJun Teler when the call connects.
   * Requirement: Must return 200 OK with single JSON Call Flow action within 5 seconds.
   */
  public handleCallFlow = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const body = (req.body || {}) as any;
      const callId = body.call_id || (req.query.call_id as string) || `cs_inbound_${Date.now()}`;
      const fromNumber = body.from_number || body.from || (req.query.from as string) || (req.query.from_number as string) || "";
      const toNumber = body.to_number || body.to || (req.query.to as string) || (req.query.to_number as string) || "";
      const direction = body.direction || "inbound";

      this.logger.info("Handling Call Flow request from FreJun Teler", {
        callId,
        fromNumber,
        toNumber,
        direction,
      });

      // 1. Resolve Lead and Agent Context from CRM
      let candidate = null;
      let creator = null;
      const cleanFrom = fromNumber.replace(/\D/g, "").slice(-10);

      if (this.crmRepository) {
        candidate = await this.crmRepository.getCandidateByPhone(fromNumber);

        // Strict Lead-to-Agent Routing:
        // Case 1: Aman Lead (+918708050914) strictly pairs with Aman (+918376822509)
        if (cleanFrom === "8708050914" || candidate?.id === "cand_aman_lead") {
          const creators = await this.crmRepository.getCreators();
          creator = creators.find((c) => c.id === "creator_aman" || c.phone.endsWith("8376822509")) || null;
        }
        // Case 2: Ananya Lead (+918303831398) strictly pairs with Ritu (+917903234057)
        else if (cleanFrom === "8303831398" || candidate?.id === "cand_ananya") {
          const creators = await this.crmRepository.getCreators();
          creator = creators.find((c) => c.id === "creator_ritu" || c.phone.endsWith("7903234057")) || null;
        }
        // Case 3: If candidate exists in CRM with specific notes/tags
        else if (candidate) {
          const creators = await this.crmRepository.getCreators();
          if (candidate.notes?.includes("Ritu") || candidate.tags?.includes("Paired with Ritu")) {
            creator = creators.find((c) => c.id === "creator_ritu" || c.phone.endsWith("7903234057")) || null;
          } else {
            creator = creators.find((c) => c.id === "creator_aman" || c.phone.endsWith("8376822509")) || null;
          }
        }

        // Case 4: Unknown number ➔ Fall back to Default Agent
        if (!creator) {
          creator = await this.crmRepository.getDefaultCreator();
        }
      }

      // Determine dial target: strictly the assigned agent's phone number
      const defaultAgent = (await this.crmRepository?.getDefaultCreator()) || (await this.crmRepository?.getCreators())?.[0];
      const dialTarget = creator?.phone || defaultAgent?.phone || process.env.FREJUN_DIAL_BRIDGE_TARGET || "+918376822509";

      this.logger.info("Inbound Call Routing Resolved", {
        callId,
        caller: fromNumber,
        candidateName: candidate?.name || "Unknown Caller",
        assignedAgent: creator?.name || defaultAgent?.name || "Aman",
        dialTarget,
      });

      // Generate instructions per configured call flow action (dial)
      const flow = this.telephonyService.generateCallFlow({
        callId,
        accountId: body.account_id,
        fromNumber,
        toNumber,
        direction,
        dialTarget,
      });

      // Update or create call session in repository
      if (callId) {
        let existing = await this.callRepository.findById(callId);
        const callerName = candidate?.name || (cleanFrom ? `Lead (${fromNumber})` : "Customer Lead");
        const receiverName = creator?.name || defaultAgent?.name || "Aman";
        const note = candidate
          ? `Inbound Call: ${candidate.name} (${fromNumber}) strictly routed to ${receiverName} (${dialTarget})`
          : `Inbound Call: Unknown Caller (${fromNumber}) routed to Default Agent ${receiverName} (${dialTarget})`;

        if (!existing) {
          await this.callRepository.create({
            callId,
            provider: this.telephonyService.providerName,
            fromNumber,
            toNumber,
            state: "answered",
            record: true,
            createdAt: new Date().toISOString(),
            answeredAt: new Date().toISOString(),
            flowAction: flow.action,
            metadata: {
              callDirection: "inbound",
              source: "frejun_teler_flow",
              candidate: candidate
                ? { id: candidate.id, name: candidate.name, phone: candidate.phone, company: candidate.company }
                : undefined,
              creator: creator
                ? { id: creator.id, name: creator.name, phone: creator.phone, email: creator.email }
                : undefined,
              callerName,
              receiverName,
              note,
            },
          });
        } else {
          await this.callRepository.update(callId, {
            state: "answered",
            flowAction: flow.action,
            answeredAt: new Date().toISOString(),
            metadata: {
              ...(existing.metadata || {}),
              callerName,
              receiverName,
              note,
            },
          });
        }
      }

      this.logger.info("Responding with Call Flow JSON", {
        callId,
        flowPayload: flow.rawPayload,
      });

      // Send exact JSON Call Flow action within 5 seconds
      res.setHeader("Content-Type", "application/json");
      res.status(200).json(flow.rawPayload);
    } catch (error) {
      this.logger.error("Error generating Call Flow", error);
      // Fallback hangup action if exception occurs to prevent stuck call
      res.status(200).json({ action: "hangup" });
    }
  };

  /**
   * POST /api/teler/status
   * Handles Call Status Webhook events from FreJun Teler (call.initiated, call.answered, call.completed, call.failed).
   * Requirement: Verify HMAC-SHA256 signature, dedupe on event.id, respond within 5s with 200 OK.
   */
  public handleStatusWebhook = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const timestamp = req.header("X-Teler-Timestamp") || "";
    const signature = req.header("X-Teler-Signature") || "";
    const source = req.header("X-Teler-Source") || "live";
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));

    this.logger.info("Received FreJun Teler webhook delivery", {
      source,
      hasTimestamp: !!timestamp,
      hasSignature: !!signature,
    });

    // 1. Verify HMAC-SHA256 signature
    const isValid = this.telephonyService.verifyWebhookSignature(rawBody, timestamp, signature);
    if (!isValid) {
      this.logger.warn("Rejecting webhook: Invalid signature or expired timestamp (401)");
      res.status(401).json({ error: "Invalid webhook signature or expired timestamp" });
      return;
    }

    // 2. Parse event envelope (2026-06-01 or legacy)
    const event = this.telephonyService.parseWebhookEvent(req.body);

    // 3. Deduplicate by event.id across retries and manual replays
    if (event.eventId && this.deduplicationService.hasSeenWebhookEvent(event.eventId)) {
      this.logger.info("Duplicate webhook event received; returning 200 OK idempotently", {
        eventId: event.eventId,
        eventType: event.eventType,
        callId: event.callId,
      });
      res.status(200).json({ status: "acknowledged", duplicate: true });
      return;
    }

    if (event.eventId) {
      this.deduplicationService.markWebhookEventProcessed(event.eventId);
    }

    this.logger.info(`Processing lifecycle event: ${event.eventType}`, {
      eventId: event.eventId,
      callId: event.callId,
      occurredAt: event.occurredAt,
      data: event.data,
    });

    // 4. Ensure call session exists in repository (for Inbound calls arriving from outside)
    if (event.callId) {
      const existing = await this.callRepository.findById(event.callId);
      if (!existing) {
        const from =
          (event.data?.candidate_number as string) ||
          (event.data?.customer_number as string) ||
          (event.data?.caller_number as string) ||
          (event.data?.from as string) ||
          (event.data?.from_number as string) ||
          "";
        const to =
          (event.data?.virtual_number as string) ||
          (event.data?.to as string) ||
          (event.data?.to_number as string) ||
          "";

        let direction =
          (event.data?.direction as string) ||
          (event.data?.call_type as string) ||
          "inbound";

        const rawStatus = (
          (event.data?.call_status as string) ||
          (event.data?.status as string) ||
          ""
        ).toLowerCase().trim();

        if (rawStatus.includes("inbound")) {
          direction = "inbound";
        } else if (rawStatus.includes("outbound")) {
          direction = "outbound";
        }

        let candidate = null;
        let creator = null;
        if (this.crmRepository) {
          if (direction === "inbound") {
            candidate = await this.crmRepository.getCandidateByPhone(from);
            const cleanFrom = from.replace(/\D/g, "").slice(-10);

            if (cleanFrom === "8708050914" || candidate?.id === "cand_aman_lead") {
              const creators = await this.crmRepository.getCreators();
              creator = creators.find((c) => c.id === "creator_aman" || c.phone.endsWith("8376822509")) || null;
            } else if (cleanFrom === "8303831398" || candidate?.id === "cand_ananya") {
              const creators = await this.crmRepository.getCreators();
              creator = creators.find((c) => c.id === "creator_ritu" || c.phone.endsWith("7903234057")) || null;
            } else if (candidate) {
              const creators = await this.crmRepository.getCreators();
              creator = candidate.notes?.includes("Ritu")
                ? creators.find((c) => c.id === "creator_ritu" || c.phone.endsWith("7903234057")) || null
                : creators.find((c) => c.id === "creator_aman" || c.phone.endsWith("8376822509")) || null;
            }

            if (!creator) {
              creator = await this.crmRepository.getDefaultCreator();
            }
          } else {
            creator = await this.crmRepository.getCreatorByPhone(from);
            candidate = await this.crmRepository.getCandidateByPhone(to);
          }
        }

        const defaultAgent = (await this.crmRepository?.getDefaultCreator()) || (await this.crmRepository?.getCreators())?.[0];
        const assignedAgent = creator || defaultAgent;
        const candidateDisplayName = (event.data?.candidate_name as string) || candidate?.name;
        const callerName = direction === "inbound" ? (candidateDisplayName || `Lead (${from})`) : (assignedAgent?.name || "Agent");
        const receiverName = direction === "inbound" ? (assignedAgent?.name || "Agent") : (candidateDisplayName || `Customer (${to})`);
        const dialTarget = assignedAgent?.phone || process.env.FREJUN_DIAL_BRIDGE_TARGET || "+918376822509";

        let initialState: "initiated" | "ringing" | "answered" | "completed" | "failed" = "initiated";
        if (
          event.eventType === "call.completed" ||
          rawStatus.includes("completed") ||
          rawStatus.includes("ended") ||
          rawStatus === "success"
        ) {
          initialState = "completed";
        } else if (
          event.eventType === "call.answered" ||
          rawStatus.includes("answered") ||
          rawStatus.includes("in_progress") ||
          rawStatus === "picked"
        ) {
          initialState = "answered";
        } else if (
          event.eventType === "call.failed" ||
          rawStatus.includes("failed") ||
          rawStatus.includes("missed") ||
          rawStatus.includes("busy") ||
          rawStatus.includes("no_answer") ||
          rawStatus.includes("rejected") ||
          rawStatus.includes("canceled")
        ) {
          initialState = "failed";
        } else if (rawStatus.includes("ringing")) {
          initialState = "ringing";
        }

        const rawDuration =
          typeof event.data?.duration === "number"
            ? event.data.duration
            : typeof event.data?.duration_seconds === "number"
            ? event.data.duration_seconds
            : undefined;
        const durationSeconds =
          typeof rawDuration === "number"
            ? rawDuration > 1000
              ? Math.round(rawDuration / 1000)
              : rawDuration
            : undefined;

        const answeredAt =
          (event.data?.answer_time as string) ||
          (event.data?.answered_at as string) ||
          (initialState === "answered" ? event.occurredAt : undefined);

        const endedAt =
          (event.data?.end_time as string) ||
          (event.data?.ended_at as string) ||
          (initialState === "completed" ? event.occurredAt : undefined);

        await this.callRepository.create({
          callId: event.callId,
          provider: event.provider || "frejun",
          fromNumber: from,
          toNumber: to,
          state: initialState,
          record: true,
          createdAt: event.occurredAt || new Date().toISOString(),
          answeredAt,
          endedAt,
          durationSeconds,
          metadata: {
            callDirection: direction,
            source: "frejun_webhook",
            dialerCallStatus: (event.data?.call_status as string) || rawStatus,
            candidate: candidate
              ? { id: candidate.id, name: candidate.name, phone: candidate.phone, company: candidate.company }
              : undefined,
            creator: assignedAgent
              ? { id: assignedAgent.id, name: assignedAgent.name, phone: assignedAgent.phone, email: assignedAgent.email }
              : undefined,
            callerName,
            receiverName,
            dialTarget,
            note:
              direction === "inbound"
                ? `Inbound Call: ${callerName} (${from}) strictly routed to ${receiverName} (${dialTarget})`
                : `Outbound Call: ${callerName} (${from}) ➔ ${receiverName} (${to})`,
          },
        });
      }
    }

    // 5. Persist event and update call state asynchronously
    this.callRepository.saveEvent(event).catch((err) => {
      this.logger.error("Failed to persist webhook event in repository", err, { eventId: event.eventId });
    });

    // 6. Acknowledge immediately within 5 seconds with 200 OK
    res.status(200).json({ status: "acknowledged", eventId: event.eventId });
  };
}
