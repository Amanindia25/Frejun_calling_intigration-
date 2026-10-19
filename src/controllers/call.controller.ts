import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { ITelephonyService } from "../services/interfaces/telephony.service.interface";
import { ICallRepository } from "../services/interfaces/call.repository.interface";
import { IDeduplicationService } from "../services/interfaces/deduplication.service.interface";
import { ApiResponse } from "../types/api.types";
import { CallSessionDto } from "../types/telephony.types";
import { isValidE164, normalizePhoneNumber } from "../utils/phone.utils";
import { Logger } from "../utils/logger";

import { ICrmRepository } from "../services/crm.repository";

export const initiateCallSchema = z.object({
  toNumber: z
    .string()
    .min(1, "toNumber is required")
    .transform((val) => normalizePhoneNumber(val))
    .refine((val) => isValidE164(val), {
      message: "Destination phone number must be in valid E.164 format (e.g. +919876543210)",
    }),
  fromNumber: z
    .string()
    .optional()
    .transform((val) => (val ? normalizePhoneNumber(val) : undefined))
    .refine((val) => !val || isValidE164(val), {
      message: "Caller phone number must be in valid E.164 format (e.g. +91XXXXXXXXXX)",
    }),
  creatorId: z.string().optional(),
  candidateId: z.string().optional(),
  userEmail: z.string().email().optional(),
  creatorNumber: z.string().optional(),
  flowUrl: z.string().url("flowUrl must be a valid URL").optional(),
  statusCallbackUrl: z.string().url("statusCallbackUrl must be a valid URL").optional(),
  record: z.boolean().optional(),
  idempotencyKey: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type InitiateCallInput = z.infer<typeof initiateCallSchema>;

export class CallController {
  private telephonyService: ITelephonyService;
  private callRepository: ICallRepository;
  private deduplicationService: IDeduplicationService;
  private crmRepository?: ICrmRepository;
  private logger = new Logger("CallController");

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
   * POST /api/calls
   * Initiates an outbound one-click call
   */
  public initiateCall = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = req.body as InitiateCallInput;
      let targetNumber = input.toNumber;
      let userEmail = input.userEmail;
      let creatorNumber = input.creatorNumber;
      const metadata = { ...(input.metadata || {}) };

      // Resolve Candidate context if candidateId provided
      if (input.candidateId && this.crmRepository) {
        const candidate = await this.crmRepository.getCandidateById(input.candidateId);
        if (candidate) {
          targetNumber = candidate.phone;
          metadata.candidate = {
            id: candidate.id,
            name: candidate.name,
            phone: candidate.phone,
            company: candidate.company,
          };
        }
      }
      metadata.callDirection = "outbound";

      // Resolve Creator / Agent context if creatorId provided or fetch default
      if (this.crmRepository) {
        let creator = input.creatorId
          ? await this.crmRepository.getCreatorById(input.creatorId)
          : await this.crmRepository.getDefaultCreator();

        if (creator) {
          userEmail = userEmail || creator.email;
          if (!creatorNumber) {
            creatorNumber = creator.phone;
          }
          metadata.creator = {
            id: creator.id,
            name: creator.name,
            email: creator.email,
            phone: creator.phone,
            role: creator.role,
          };
        }
      }

      // STRICT CRM PAIRING ENFORCEMENT:
      // Pair 1: Aman (+918376822509) ⇄ Aman Lead (+918708050914)
      // Pair 2: Ritu (+917903234057) ⇄ Ananya (+918303831398)
      const cleanCreator = (creatorNumber || "").replace(/\D/g, "").slice(-10);
      const cleanTarget = (targetNumber || "").replace(/\D/g, "").slice(-10);

      // Aman can NEVER call Ananya (and Ananya can never call Aman)
      if (
        (cleanCreator === "8376822509" && cleanTarget === "8303831398") ||
        (cleanCreator === "8303831398" && cleanTarget === "8376822509")
      ) {
        this.logger.warn("Strict pairing violation blocked: Aman cannot call Ananya", {
          creatorNumber,
          targetNumber,
        });
        res.status(400).json({
          success: false,
          error: {
            code: "STRICT_PAIRING_VIOLATION",
            message: "Strict Pairing Rule: Aman (+91 8376822509) is paired exclusively with Aman Lead (+91 8708050914) and can NEVER call Ananya.",
          },
        });
        return;
      }

      // Ritu can NEVER call Aman Lead (and Aman Lead can never call Ritu)
      if (
        (cleanCreator === "7903234057" && cleanTarget === "8708050914") ||
        (cleanCreator === "8708050914" && cleanTarget === "7903234057")
      ) {
        this.logger.warn("Strict pairing violation blocked: Ritu cannot call Aman Lead", {
          creatorNumber,
          targetNumber,
        });
        res.status(400).json({
          success: false,
          error: {
            code: "STRICT_PAIRING_VIOLATION",
            message: "Strict Pairing Rule: Ritu (+91 7903234057) is paired exclusively with Ananya (+91 8303831398) and can NEVER call Aman Lead.",
          },
        });
        return;
      }


      this.logger.info("Received outbound call request", {
        toNumber: targetNumber,
        creatorNumber,
        userEmail,
      });

      // Initiate call via telephony provider
      const session = await this.telephonyService.initiateCall({
        toNumber: targetNumber,
        fromNumber: input.fromNumber,
        creatorId: input.creatorId,
        candidateId: input.candidateId,
        userEmail,
        creatorNumber,
        flowUrl: input.flowUrl,
        statusCallbackUrl: input.statusCallbackUrl,
        record: input.record,
        idempotencyKey: input.idempotencyKey,
        metadata,
      });

      // Persist in repository
      await this.callRepository.create(session);

      // Register call to candidate in CRM stats
      if (this.crmRepository) {
        await this.crmRepository.recordCallToCandidate(input.candidateId || targetNumber);
      }

      // Register call in deduplication service to prevent rapid accidental re-dials
      this.deduplicationService.registerCall(
        session.toNumber,
        session.callId,
        input.idempotencyKey
      );

      res.status(201).json({
        success: true,
        message: "Outbound call initiated successfully",
        data: session,
      } as ApiResponse);
    } catch (error) {
      // Clear cooldown if initiation failed
      if (req.body?.toNumber) {
        this.deduplicationService.clearCallCooldown(req.body.toNumber, req.body.idempotencyKey);
      }
      next(error);
    }
  };

  /**
   * GET /api/calls/:id
   * Retrieves single call session by ID
   */
  public getCall = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const callId = (Array.isArray(req.params.id) ? req.params.id[0] : req.params.id) as string;
      let session = await this.callRepository.findById(callId);

      // If not in local repo or incomplete, query provider
      if (!session || (session.state !== "completed" && session.state !== "failed")) {
        const live = await this.telephonyService.getCall(callId);
        if (live) {
          session = await this.callRepository.update(callId, live);
        }
      }

      if (!session) {
        res.status(404).json({
          success: false,
          error: {
            code: "CALL_NOT_FOUND",
            message: `Call with ID '${callId}' was not found.`,
          },
        } as ApiResponse);
        return;
      }

      res.status(200).json({
        success: true,
        data: session,
      } as ApiResponse);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Internal helper to sync call records from FreJun API
   */
  public syncCallsInternal = async (): Promise<CallSessionDto[]> => {
    if (!this.telephonyService.fetchCallLogs) {
      return this.callRepository.list(50);
    }

    try {
      const logs = await this.telephonyService.fetchCallLogs();
      if (!logs || !Array.isArray(logs) || logs.length === 0) {
        return this.callRepository.list(50);
      }

      for (const log of logs) {
        const callId = log.call_id || `cs_frejun_${log.id}`;
        if (!callId) continue;

        const isIncoming = log.call_type === "incoming";
        const candidatePhone = log.candidate_number || "";
        const creatorPhone = log.creator_number || "";
        const virtualPhone = log.virtual_number || "";

        const fromNumber = isIncoming ? candidatePhone : (creatorPhone || virtualPhone);
        const toNumber = isIncoming ? (creatorPhone || virtualPhone) : candidatePhone;

        // Resolve CRM context
        let candidate = null;
        let creator = null;

        if (this.crmRepository) {
          if (candidatePhone) {
            candidate = await this.crmRepository.getCandidateByPhone(candidatePhone);
          }
          if (creatorPhone) {
            creator = await this.crmRepository.getCreatorByPhone(creatorPhone);
          }
          if (!creator) {
            creator = await this.crmRepository.getDefaultCreator();
          }
        }

        const callerName = isIncoming
          ? (candidate?.name || `Customer (${candidatePhone})`)
          : (creator?.name || "Agent");
        const receiverName = isIncoming
          ? (creator?.name || "Agent")
          : (candidate?.name || `Lead (${candidatePhone})`);

        // State mapping
        let state: "initiated" | "ringing" | "answered" | "completed" | "failed" = "completed";
        const rawStatus = (log.status || "").toLowerCase();
        if (rawStatus === "answered" || rawStatus === "completed" || rawStatus === "ended") {
          state = "completed";
        } else if (rawStatus === "user-not-answered" || rawStatus === "user-busy" || rawStatus === "failed") {
          state = "failed";
        } else if (rawStatus === "ringing") {
          state = "ringing";
        } else if (rawStatus === "initiated") {
          state = "initiated";
        }

        // Duration in seconds (FreJun provides call_duration in minutes: 0.48 * 60 = 29s)
        const durationSeconds = log.call_duration !== undefined && log.call_duration !== null
          ? Math.round(Number(log.call_duration) * 60)
          : undefined;

        const createdAt = log.call_start_time
          ? (String(log.call_start_time).endsWith("Z") ? log.call_start_time : `${log.call_start_time}Z`)
          : new Date().toISOString();

        const endedAt = log.call_end_time
          ? (String(log.call_end_time).endsWith("Z") ? log.call_end_time : `${log.call_end_time}Z`)
          : undefined;

        const existing = await this.callRepository.findById(callId);
        if (!existing) {
          await this.callRepository.create({
            callId,
            provider: "frejun",
            fromNumber,
            toNumber,
            state,
            record: !!log.recording_url,
            createdAt,
            answeredAt: createdAt,
            endedAt,
            durationSeconds,
            recordingUrl: log.recording_url || undefined,
            reason: log.call_reason || log.status,
            metadata: {
              callDirection: isIncoming ? "inbound" : "outbound",
              source: "frejun_sync",
              frejunId: log.id,
              virtualNumber: log.virtual_number,
              recruiter: log.recruiter,
              sharedLink: log.link,
              callerName,
              receiverName,
              candidate: candidate
                ? { id: candidate.id, name: candidate.name, phone: candidate.phone, company: candidate.company }
                : undefined,
              creator: creator
                ? { id: creator.id, name: creator.name, phone: creator.phone, email: creator.email }
                : undefined,
              note: isIncoming
                ? `Inbound Call: ${callerName} (${fromNumber}) ➔ ${receiverName} (${toNumber})`
                : `Outbound Call: ${callerName} (${fromNumber}) ➔ ${receiverName} (${toNumber})`,
            },
          });

          // Save event so Webhook / Event feed is also updated!
          await this.callRepository.saveEvent({
            eventId: `evt_sync_${log.id}_${Date.now()}`,
            eventType: `call.${state}`,
            callId,
            provider: "frejun",
            occurredAt: createdAt,
            data: {
              status: log.status,
              duration_seconds: durationSeconds,
              recording_url: log.recording_url,
              direction: isIncoming ? "inbound" : "outbound",
              from: fromNumber,
              to: toNumber,
              source: "frejun_sync",
            },
          });
        } else {
          // Update existing with duration and recordingUrl if missing
          await this.callRepository.update(callId, {
            state: existing.state === "completed" ? "completed" : state,
            endedAt: endedAt || existing.endedAt,
            durationSeconds: durationSeconds !== undefined ? durationSeconds : existing.durationSeconds,
            recordingUrl: log.recording_url || existing.recordingUrl,
            metadata: {
              ...(existing.metadata || {}),
              frejunId: log.id,
              sharedLink: log.link || (existing.metadata as any)?.sharedLink,
            },
          });
        }
      }
    } catch (err) {
      this.logger.error("Error during syncCallsInternal", err);
    }

    return this.callRepository.list(50);
  };

  /**
   * POST /api/calls/sync or GET /api/calls/sync
   * Explicitly triggers synchronization from FreJun Integrations API
   */
  public syncCalls = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const calls = await this.syncCallsInternal();
      res.status(200).json({
        success: true,
        message: `Successfully synchronized ${calls.length} calls from FreJun`,
        data: calls,
      } as ApiResponse);
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/calls
   * Lists recent call sessions (automatically syncs from FreJun)
   */
  public listCalls = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const limit = parseInt(req.query.limit as string, 10) || 50;
      await this.syncCallsInternal();
      const calls = await this.callRepository.list(limit);

      res.status(200).json({
        success: true,
        data: calls,
        meta: {
          count: calls.length,
          limit,
        },
      } as ApiResponse);
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/calls/events
   * Lists recent telephony webhook events
   */
  public listEvents = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const callId = typeof req.query.callId === "string" ? req.query.callId : undefined;
      const limit = parseInt(req.query.limit as string, 10) || 50;
      const events = await this.callRepository.getEvents(callId, limit);

      res.status(200).json({
        success: true,
        data: events,
        meta: {
          count: events.length,
          callId: callId || null,
        },
      } as ApiResponse);
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/calls/:id/hangup
   * Ends an active call session
   */
  public hangupCall = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const callId = (Array.isArray(req.params.id) ? req.params.id[0] : req.params.id) as string;
      const session = await this.callRepository.findById(callId);
      if (!session) {
        res.status(404).json({
          success: false,
          error: {
            code: "CALL_NOT_FOUND",
            message: `Call with ID '${callId}' not found.`,
          },
        } as ApiResponse);
        return;
      }

      const now = new Date().toISOString();
      const startTime = session.answeredAt || session.createdAt;
      const durationSeconds = startTime
        ? Math.max(1, Math.round((Date.now() - new Date(startTime).getTime()) / 1000))
        : 0;

      const updated = await this.callRepository.update(callId, {
        state: "completed",
        endedAt: now,
        durationSeconds,
        reason: "Call ended by user",
      });

      // Clear cooldown in deduplication service
      this.deduplicationService.clearCallCooldown(session.toNumber);

      // Save call.completed event
      await this.callRepository.saveEvent({
        eventId: `evt_hangup_${Date.now()}`,
        eventType: "call.completed",
        callId,
        provider: session.provider,
        occurredAt: now,
        data: {
          duration_seconds: durationSeconds,
          ended_at: now,
          reason: "User ended call from CRM UI",
        },
      });

      res.status(200).json({
        success: true,
        message: "Call ended successfully",
        data: updated,
      } as ApiResponse);
    } catch (error) {
      next(error);
    }
  };
}

