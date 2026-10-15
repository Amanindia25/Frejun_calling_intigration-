import { IDeduplicationService } from "./interfaces/deduplication.service.interface";
import { Logger } from "../utils/logger";

interface InFlightCallRecord {
  toNumber: string;
  callId: string;
  idempotencyKey?: string;
  expiresAt: number;
}

export class MemoryDeduplicationService implements IDeduplicationService {
  private inFlightCalls: Map<string, InFlightCallRecord> = new Map();
  private idempotencyKeys: Map<string, InFlightCallRecord> = new Map();
  private seenWebhookEvents: Map<string, number> = new Map();
  private cooldownMs: number;
  private logger = new Logger("DeduplicationService");

  constructor(cooldownSeconds = 15) {
    this.cooldownMs = cooldownSeconds * 1000;
    // Periodic garbage collection every 60 seconds
    setInterval(() => this.cleanupExpired(), 60000).unref();
  }

  public isDuplicateCall(
    toNumber: string,
    idempotencyKey?: string
  ): { isDuplicate: boolean; remainingCooldownMs?: number; activeCallId?: string } {
    const now = Date.now();

    // 1. Check idempotency key if provided
    if (idempotencyKey) {
      const existingKeyRecord = this.idempotencyKeys.get(idempotencyKey);
      if (existingKeyRecord && existingKeyRecord.expiresAt > now) {
        return {
          isDuplicate: true,
          remainingCooldownMs: existingKeyRecord.expiresAt - now,
          activeCallId: existingKeyRecord.callId,
        };
      }
    }

    // 2. Check destination number cooldown
    const existingNumRecord = this.inFlightCalls.get(toNumber);
    if (existingNumRecord && existingNumRecord.expiresAt > now) {
      return {
        isDuplicate: true,
        remainingCooldownMs: existingNumRecord.expiresAt - now,
        activeCallId: existingNumRecord.callId,
      };
    }

    return { isDuplicate: false };
  }

  public registerCall(toNumber: string, callId: string, idempotencyKey?: string): void {
    const expiresAt = Date.now() + this.cooldownMs;
    const record: InFlightCallRecord = {
      toNumber,
      callId,
      idempotencyKey,
      expiresAt,
    };

    this.inFlightCalls.set(toNumber, record);
    if (idempotencyKey) {
      this.idempotencyKeys.set(idempotencyKey, record);
    }

    this.logger.debug("Registered call in deduplication guard", {
      toNumber,
      callId,
      idempotencyKey,
      expiresAt: new Date(expiresAt).toISOString(),
    });
  }

  public clearCallCooldown(toNumber: string, idempotencyKey?: string): void {
    this.inFlightCalls.delete(toNumber);
    if (idempotencyKey) {
      this.idempotencyKeys.delete(idempotencyKey);
    }
  }

  public hasSeenWebhookEvent(eventId: string): boolean {
    const expiresAt = this.seenWebhookEvents.get(eventId);
    if (!expiresAt) return false;
    if (expiresAt < Date.now()) {
      this.seenWebhookEvents.delete(eventId);
      return false;
    }
    return true;
  }

  public markWebhookEventProcessed(eventId: string): void {
    // Retain webhook event IDs for 24 hours (86400000 ms) for deduplication of retries
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    this.seenWebhookEvents.set(eventId, expiresAt);
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, val] of this.inFlightCalls.entries()) {
      if (val.expiresAt <= now) this.inFlightCalls.delete(key);
    }
    for (const [key, val] of this.idempotencyKeys.entries()) {
      if (val.expiresAt <= now) this.idempotencyKeys.delete(key);
    }
    for (const [key, expiresAt] of this.seenWebhookEvents.entries()) {
      if (expiresAt <= now) this.seenWebhookEvents.delete(key);
    }
  }
}
