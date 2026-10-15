import { Request, Response, NextFunction } from "express";

declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

/**
 * Capture raw request body bytes for HMAC-SHA256 signature verification
 */
export function rawBodySaver(req: Request, _res: Response, buf: Buffer, _encoding: string): void {
  if (buf && buf.length) {
    req.rawBody = buf;
  }
}
