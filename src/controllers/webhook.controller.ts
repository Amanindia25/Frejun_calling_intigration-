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
      const body = req.body as FreJunCallFlowRequest;
      const callId = body.call_id || (req.query.call_id as string);
      const fromNumber = body.from_number || "";
      const toNumber = body.to_number || "";
      const direction = body.direction || "inbound";

      this.logger.info("Handling Call Flow request from FreJun Teler", {
        callId,
        fromNumber,
        toNumber,
        direction,
      });

      // Resolve candidate and creator context from CRM
      let candidate = null;
      let creator = null;
      if (this.crmRepository) {
        candidate = await this.crmRepository.getCandidateByPhone(fromNumber);
        const cleanFrom = fromNumber.replace(/\D/g, "").slice(-10);

        // Strict pairing: Aman Lead (+918935926120) strictly pairs with Aman (+918376822509)
        if (cleanFrom === "8935926120" || candidate?.id === "cand_ayush") {
          const creators = await this.crmRepository.getCreators();
          creator = creators.find((c) => c.id === "creator_aman" || c.phone.endsWith("8376822509")) || null;
        } else if (cleanFrom === "8303831398" || candidate?.id === "cand_ananya") {
          const creators = await this.crmRepository.getCreators();
          creator = creators.find((c) => c.id === "creator_ritu" || c.phone.endsWith("7903234057")) || null;
        }

        if (!creator && toNumber) {
          creator = await this.crmRepository.getCreatorByPhone(toNumber);
        }
        if (!creator) {
          creator = await this.crmRepository.getDefaultCreator();
        }
      }

      // Determine dial target for bridging (Agent phone number)
      const dialTarget = creator?.phone || toNumber;

      // Generate instructions per configured call flow action (play, dial, stream, hangup)
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
              callerName: candidate?.name || "Customer Lead",
              receiverName: creator?.name || "Agent",
              note: `Inbound Call: ${candidate?.name || fromNumber} (Customer) ➔ ${creator?.name || dialTarget} (Agent)`,
            },
          });
        } else {
          await this.callRepository.update(callId, {
            state: "answered",
            flowAction: flow.action,
            answeredAt: new Date().toISOString(),
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
        const from = (event.data?.from as string) || (event.data?.from_number as string) || "";
        const to = (event.data?.to as string) || (event.data?.to_number as string) || "";
        const direction = (event.data?.direction as string) || "inbound";

        let candidate = null;
        let creator = null;
        if (this.crmRepository) {
          if (direction === "inbound") {
            candidate = await this.crmRepository.getCandidateByPhone(from);
            const cleanFrom = from.replace(/\D/g, "").slice(-10);
            if (cleanFrom === "8935926120" || candidate?.id === "cand_ayush") {
              const creators = await this.crmRepository.getCreators();
              creator = creators.find((c) => c.id === "creator_aman" || c.phone.endsWith("8376822509")) || null;
            } else if (cleanFrom === "8303831398" || candidate?.id === "cand_ananya") {
              const creators = await this.crmRepository.getCreators();
              creator = creators.find((c) => c.id === "creator_ritu" || c.phone.endsWith("7903234057")) || null;
            }
            if (!creator && to) {
              creator = await this.crmRepository.getCreatorByPhone(to);
            }
            if (!creator) {
              creator = await this.crmRepository.getDefaultCreator();
            }
          } else {
            creator = await this.crmRepository.getCreatorByPhone(from);
            candidate = await this.crmRepository.getCandidateByPhone(to);
          }
        }

        await this.callRepository.create({
          callId: event.callId,
          provider: event.provider || "frejun",
          fromNumber: from,
          toNumber: to,
          state: event.eventType === "call.completed" ? "completed" : event.eventType === "call.answered" ? "answered" : "initiated",
          record: true,
          createdAt: event.occurredAt || new Date().toISOString(),
          answeredAt: (event.data?.answered_at as string) || (event.eventType === "call.answered" ? event.occurredAt : undefined),
          endedAt: (event.data?.ended_at as string) || (event.eventType === "call.completed" ? event.occurredAt : undefined),
          durationSeconds: typeof event.data?.duration_seconds === "number" ? event.data.duration_seconds : undefined,
          metadata: {
            callDirection: direction,
            source: "frejun_webhook",
            candidate: candidate
              ? { id: candidate.id, name: candidate.name, phone: candidate.phone, company: candidate.company }
              : undefined,
            creator: creator
              ? { id: creator.id, name: creator.name, phone: creator.phone, email: creator.email }
              : undefined,
            callerName: direction === "inbound" ? (candidate?.name || "Customer Lead") : (creator?.name || "Agent"),
            receiverName: direction === "inbound" ? (creator?.name || "Agent") : (candidate?.name || "Customer Lead"),
            note:
              direction === "inbound"
                ? `Inbound Call: ${candidate?.name || from} (Customer) ➔ ${creator?.name || to} (Agent)`
                : `Outbound Call: ${creator?.name || from} (Agent) ➔ ${candidate?.name || to} (Customer)`,
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
