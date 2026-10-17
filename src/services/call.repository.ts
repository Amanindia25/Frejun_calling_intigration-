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
      const eventData = (event.data || {}) as Record<string, unknown>;

      // 1. Lifecycle Events (call.status, call.initiated, call.answered, call.completed, call.failed)
      if (event.eventType === "call.initiated") {
        updates.state = "initiated";
      } else if (event.eventType === "call.answered") {
        updates.state = "answered";
        updates.answeredAt = (eventData.answered_at as string) || event.occurredAt;
      } else if (event.eventType === "call.completed") {
        updates.state = "completed";
        updates.endedAt = (eventData.ended_at as string) || event.occurredAt;
        if (typeof eventData.duration_seconds === "number") {
          updates.durationSeconds = eventData.duration_seconds;
        } else if (typeof eventData.duration === "number") {
          updates.durationSeconds = eventData.duration;
        }
        if (typeof eventData.reason === "string") {
          updates.reason = eventData.reason;
        }
        const recUrl =
          (eventData.recording_url as string) ||
          (eventData.media_url as string) ||
          (eventData.recording as string) ||
          (eventData.url as string);
        if (recUrl) {
          updates.recordingUrl = recUrl;
        }
      } else if (event.eventType === "call.failed") {
        updates.state = "failed";
        updates.endedAt = (eventData.ended_at as string) || event.occurredAt;
        if (typeof eventData.reason === "string") {
          updates.reason = eventData.reason;
        }
      } else if (event.eventType === "call.status") {
        // FreJun Knowledge Base call.status generic event
        const rawStatus = (
          (eventData.status as string) ||
          (eventData.call_status as string) ||
          ""
        ).toLowerCase();

        if (rawStatus === "answered" || rawStatus === "in_progress") {
          updates.state = "answered";
          updates.answeredAt = (eventData.answered_at as string) || (eventData.answer_time as string) || event.occurredAt;
        } else if (rawStatus === "completed" || rawStatus === "ended" || rawStatus === "success") {
          updates.state = "completed";
          updates.endedAt = (eventData.ended_at as string) || (eventData.hangup_time as string) || event.occurredAt;
          if (typeof eventData.duration === "number") updates.durationSeconds = eventData.duration;
          if (typeof eventData.duration_seconds === "number") updates.durationSeconds = eventData.duration_seconds;
        } else if (rawStatus === "failed" || rawStatus === "missed" || rawStatus === "busy" || rawStatus === "no_answer") {
          updates.state = "failed";
          updates.reason = rawStatus;
        } else if (rawStatus === "initiated" || rawStatus === "ringing") {
          updates.state = rawStatus as any;
        }
      }

      // 2. Recording Events (call.recording or recording.completed)
      if (event.eventType === "recording.completed" || event.eventType === "call.recording") {
        const recUrl =
          (eventData.recording_url as string) ||
          (eventData.media_url as string) ||
          (eventData.recording as string) ||
          (eventData.url as string);
        if (recUrl) {
          updates.recordingUrl = recUrl;
        }
      }

      // 3. AI Insights (call.insights)
      if (event.eventType === "call.insights") {
        const insights = eventData.insights || eventData.summary || eventData;
        updates.metadata = {
          ...(existing.metadata || {}),
          insights,
        };
      }

      // 4. Property Change Events (call.propertyChange.*)
      if (event.eventType === "call.propertyChange.notes") {
        const notes = (eventData.notes as string) || (eventData.value as string);
        updates.metadata = {
          ...(existing.metadata || {}),
          crmNotes: notes,
        };
      } else if (event.eventType === "call.propertyChange.call_reason") {
        const callReason = (eventData.call_reason as string) || (eventData.reason as string) || (eventData.value as string);
        updates.reason = callReason;
        updates.metadata = {
          ...(existing.metadata || {}),
          callReason,
        };
      } else if (event.eventType === "call.propertyChange.call_outcome") {
        const outcome = (eventData.call_outcome as string) || (eventData.outcome as string) || (eventData.value as string);
        updates.metadata = {
          ...(existing.metadata || {}),
          callOutcome: outcome,
        };
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
