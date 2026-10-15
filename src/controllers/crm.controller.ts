import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { ICrmRepository } from "../services/crm.repository";
import { ApiResponse } from "../types/api.types";
import { isValidE164, normalizePhoneNumber } from "../utils/phone.utils";
import { Logger } from "../utils/logger";

const createCreatorSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Valid email address is required"),
  phone: z
    .string()
    .min(7, "Phone number is required")
    .transform((val) => normalizePhoneNumber(val))
    .refine((val) => isValidE164(val), {
      message: "Phone number must be valid E.164 (e.g. +91XXXXXXXXXX)",
    }),
  role: z.string().optional(),
  isDefault: z.boolean().optional(),
});

const createCandidateSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  phone: z
    .string()
    .min(7, "Phone number is required")
    .transform((val) => normalizePhoneNumber(val))
    .refine((val) => isValidE164(val), {
      message: "Phone number must be valid E.164 (e.g. +91XXXXXXXXXX)",
    }),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  company: z.string().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export class CrmController {
  private crmRepository: ICrmRepository;
  private logger = new Logger("CrmController");

  constructor(crmRepository: ICrmRepository) {
    this.crmRepository = crmRepository;
  }

  // --- Creator Handlers ---

  public getCreators = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const creators = await this.crmRepository.getCreators();
      res.status(200).json({
        success: true,
        data: creators,
        meta: { count: creators.length },
      } as ApiResponse);
    } catch (err) {
      next(err);
    }
  };

  public createCreator = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = createCreatorSchema.parse(req.body);
      const creator = await this.crmRepository.addCreator(parsed);
      this.logger.info("New calling creator created", { creatorId: creator.id, name: creator.name });

      res.status(201).json({
        success: true,
        message: "Calling Creator / Agent created successfully",
        data: creator,
      } as ApiResponse);
    } catch (err) {
      next(err);
    }
  };

  public deleteCreator = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const success = await this.crmRepository.deleteCreator(id);
      if (!success) {
        res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: `Creator '${id}' not found` },
        } as ApiResponse);
        return;
      }
      res.status(200).json({
        success: true,
        message: "Creator removed successfully",
      } as ApiResponse);
    } catch (err) {
      next(err);
    }
  };

  public activateCreator = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const creator = await this.crmRepository.setDefaultCreator(id);
      if (!creator) {
        res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: `Creator '${id}' not found` },
        } as ApiResponse);
        return;
      }
      res.status(200).json({
        success: true,
        message: `'${creator.name}' is now the active calling agent`,
        data: creator,
      } as ApiResponse);
    } catch (err) {
      next(err);
    }
  };

  // --- Candidate Handlers ---

  public getCandidates = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const search = typeof req.query.q === "string" ? req.query.q : undefined;
      const candidates = await this.crmRepository.getCandidates(search);
      res.status(200).json({
        success: true,
        data: candidates,
        meta: { count: candidates.length },
      } as ApiResponse);
    } catch (err) {
      next(err);
    }
  };

  public createCandidate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = createCandidateSchema.parse(req.body);
      const candidate = await this.crmRepository.addCandidate({
        ...parsed,
        email: parsed.email || undefined,
      });
      this.logger.info("New CRM lead / candidate created", {
        candidateId: candidate.id,
        name: candidate.name,
      });

      res.status(201).json({
        success: true,
        message: "Candidate / Lead saved successfully",
        data: candidate,
      } as ApiResponse);
    } catch (err) {
      next(err);
    }
  };

  public deleteCandidate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const success = await this.crmRepository.deleteCandidate(id);
      if (!success) {
        res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: `Candidate '${id}' not found` },
        } as ApiResponse);
        return;
      }
      res.status(200).json({
        success: true,
        message: "Candidate removed successfully",
      } as ApiResponse);
    } catch (err) {
      next(err);
    }
  };
}
