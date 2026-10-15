import { Request, Response, NextFunction } from "express";
import { TelephonyError } from "../services/frejun.service";
import { ApiResponse } from "../types/api.types";
import { logger } from "../utils/logger";

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error("Unhandled error caught in middleware", err, {
    path: req.path,
    method: req.method,
  });

  if (err instanceof TelephonyError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: "TELEPHONY_PROVIDER_ERROR",
        message: err.message,
        details: err.details,
      },
    } as ApiResponse);
    return;
  }

  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({
      success: false,
      error: {
        code: "MALFORMED_JSON",
        message: "The request body contains invalid JSON.",
      },
    } as ApiResponse);
    return;
  }

  const message = err instanceof Error ? err.message : "Internal server error occurred.";
  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message,
    },
  } as ApiResponse);
}
