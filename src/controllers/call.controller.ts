import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { ITelephonyService } from "../services/interfaces/telephony.service.interface";
import { ICallRepository } from "../services/interfaces/call.repository.interface";
import { IDeduplicationService } from "../services/interfaces/deduplication.service.interface";
import { ApiResponse } from "../types/api.types";
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
          if (!input.toNumber || metadata.callDirection !== "inbound") {
            targetNumber = candidate.phone;
          }
          metadata.candidate = {
            id: candidate.id,
            name: candidate.name,
            phone: candidate.phone,
            company: candidate.company,
          };
        }
      }

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
   * GET /api/calls
   * Lists recent call sessions
   */
  public listCalls = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const limit = parseInt(req.query.limit as string, 10) || 50;
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
}
