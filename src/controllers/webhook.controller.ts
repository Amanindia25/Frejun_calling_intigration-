import { Request, Response, NextFunction } from "express";
import { ITelephonyService } from "../services/interfaces/telephony.service.interface";
import { ICallRepository } from "../services/interfaces/call.repository.interface";
import { IDeduplicationService } from "../services/interfaces/deduplication.service.interface";
import { FreJunCallFlowRequest } from "../types/frejun.types";
import { Logger } from "../utils/logger";

export class WebhookController {
  private telephonyService: ITelephonyService;
  private callRepository: ICallRepository;
  private deduplicationService: IDeduplicationService;
  private logger = new Logger("WebhookController");

  constructor(
    telephonyService: ITelephonyService,
    callRepository: ICallRepository,
    deduplicationService: IDeduplicationService
  ) {
    this.telephonyService = telephonyService;
    this.callRepository = callRepository;
    this.deduplicationService = deduplicationService;
  }

  /**
   * POST /api/teler/flow
   * Handles Call Flow request from FreJun Teler when the call connects.
   * Requirement: Must return 200 OK with single JSON Call Flow action within 5 seconds.
   */
  public handleCallFlow = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as FreJunCallFlowRequest;
      const callId = body.call_id || (req.query.call_id as string);
      const fromNumber = body.from_number || "";
      const toNumber = body.to_number || "";
      const direction = body.direction || "outbound";

      this.logger.info("Handling Call Flow request from FreJun Teler", {
        callId,
        fromNumber,
        toNumber,
        direction,
      });

      // Generate instructions per configured call flow action (play, dial, stream, hangup)
      const flow = this.telephonyService.generateCallFlow({
        callId,
        accountId: body.account_id,
        fromNumber,
        toNumber,
        direction,
      });

      // Update call repository with active flow action
      if (callId) {
        this.callRepository.update(callId, {
          state: "answered",
          flowAction: flow.action,
          answeredAt: new Date().toISOString(),
        }).catch((err) => {
          this.logger.warn("Failed to update call on flow request", { err });
        });
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

    // 4. Persist event and update call state asynchronously
    this.callRepository.saveEvent(event).catch((err) => {
      this.logger.error("Failed to persist webhook event in repository", err, { eventId: event.eventId });
    });

    // 5. Acknowledge immediately within 5 seconds with 200 OK
    res.status(200).json({ status: "acknowledged", eventId: event.eventId });
  };
}
