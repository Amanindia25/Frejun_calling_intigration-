import { Request, Response, NextFunction } from "express";
import { IDeduplicationService } from "../services/interfaces/deduplication.service.interface";
import { ApiResponse } from "../types/api.types";
import { normalizePhoneNumber } from "../utils/phone.utils";

export function duplicateCallGuard(deduplicationService: IDeduplicationService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const rawTo = req.body?.toNumber;
    if (!rawTo) {
      return next();
    }

    const toNumber = normalizePhoneNumber(rawTo);
    const idempotencyKey = req.body?.idempotencyKey || (req.headers["x-idempotency-key"] as string);

    const check = deduplicationService.isDuplicateCall(toNumber, idempotencyKey);
    if (check.isDuplicate) {
      const remainingSec = check.remainingCooldownMs
        ? Math.ceil(check.remainingCooldownMs / 1000)
        : undefined;

      res.status(409).json({
        success: false,
        error: {
          code: "DUPLICATE_CALL_PREVENTED",
          message: `A call to ${toNumber} was recently initiated or is active. Please wait ${remainingSec || 15}s before dialing again.`,
          details: {
            toNumber,
            idempotencyKey,
            activeCallId: check.activeCallId,
            remainingCooldownSeconds: remainingSec,
          },
        },
      } as ApiResponse);
      return;
    }

    next();
  };
}
