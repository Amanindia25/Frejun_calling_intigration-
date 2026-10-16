import { ICallRepository } from "./interfaces/call.repository.interface";
import { CallSessionDto, TelephonyEventDto } from "../types/telephony.types";
import { Logger } from "../utils/logger";

export class InMemoryCallRepository implements ICallRepository {
  private calls: Map<string, CallSessionDto> = new Map();
  private events: TelephonyEventDto[] = [];
  private logger = new Logger("CallRepository");

  public async create(call: CallSessionDto): Promise<CallSessionDto> {
    this.calls.set(call.callId, { ...call });
    this.logger.debug("Persisted new call session", { callId: call.callId, state: call.state });
    return { ...call };
  }

  public async update(callId: string, updates: Partial<CallSessionDto>): Promise<CallSessionDto | null> {
    const existing = this.calls.get(callId);
    if (!existing) {
      return null;
    }
    const updated = {
      ...existing,
      ...updates,
      metadata: {
        ...(existing.metadata || {}),
        ...(updates.metadata || {}),
      },
    };
    this.calls.set(callId, updated);
    this.logger.debug("Updated call session", { callId, updates });
    return { ...updated };
  }

  public async findById(callId: string): Promise<CallSessionDto | null> {
    const call = this.calls.get(callId);
    return call ? { ...call } : null;
  }

  public async findActiveByDestination(toNumber: string): Promise<CallSessionDto | null> {
    for (const call of this.calls.values()) {
      if (
        call.toNumber === toNumber &&
        (call.state === "initiated" || call.state === "ringing" || call.state === "answered")
      ) {
        return { ...call };
      }
    }
    return null;
  }

  public async list(limit = 50): Promise<CallSessionDto[]> {
    const all = Array.from(this.calls.values());
    all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return all.slice(0, limit);
  }

  public async saveEvent(event: TelephonyEventDto): Promise<void> {
    this.events.unshift(event);
    if (this.events.length > 500) {
      this.events.pop(); // Keep recent 500 events
    }

    // Auto-update call state based on event type
    let existing = this.calls.get(event.callId);
    if (!existing && event.callId) {
      const from = (event.data?.from as string) || (event.data?.from_number as string) || "";
      const to = (event.data?.to as string) || (event.data?.to_number as string) || "";
      const direction = (event.data?.direction as string) || "inbound";

      existing = {
        callId: event.callId,
        provider: event.provider || "frejun",
        fromNumber: from,
        toNumber: to,
        state: "initiated",
        record: true,
        createdAt: event.occurredAt || new Date().toISOString(),
        metadata: {
          callDirection: direction,
          source: "frejun_webhook",
          ...(event.data || {}),
        },
      };
      this.calls.set(event.callId, existing);
    }

    if (existing) {
      const updates: Partial<CallSessionDto> = {};
      if (event.eventType === "call.initiated") {
        updates.state = "initiated";
      } else if (event.eventType === "call.answered") {
        updates.state = "answered";
        updates.answeredAt = (event.data.answered_at as string) || event.occurredAt;
      } else if (event.eventType === "call.completed") {
        updates.state = "completed";
        updates.endedAt = (event.data.ended_at as string) || event.occurredAt;
        if (typeof event.data.duration_seconds === "number") {
          updates.durationSeconds = event.data.duration_seconds;
        }
        if (typeof event.data.reason === "string") {
          updates.reason = event.data.reason;
        }
      } else if (event.eventType === "call.failed") {
        updates.state = "failed";
        updates.endedAt = (event.data.ended_at as string) || event.occurredAt;
        if (typeof event.data.reason === "string") {
          updates.reason = event.data.reason;
        }
      }

      await this.update(event.callId, updates);
    }
  }

  public async getEvents(callId?: string, limit = 50): Promise<TelephonyEventDto[]> {
    if (callId) {
      return this.events.filter((e) => e.callId === callId).slice(0, limit);
    }
    return this.events.slice(0, limit);
  }
}
