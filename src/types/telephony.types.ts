/**
 * Provider-Agnostic Telephony Types for Hashtagg CRM
 * Allows switching or augmenting FreJun with Twilio, Exotel, etc.
 */

export type CallState = "initiated" | "ringing" | "answered" | "completed" | "failed";

export type TelephonyProvider = "frejun" | "twilio" | "mock" | string;

/**
 * DTO for initiating an outbound call
 */
export interface InitiateCallDto {
  toNumber: string; // Destination E.164 phone number
  fromNumber?: string; // Optional caller ID (defaults to system config)
  flowUrl?: string; // Optional custom Call Flow endpoint
  statusCallbackUrl?: string; // Optional custom Webhook status endpoint
  record?: boolean; // Whether to record the call
  idempotencyKey?: string; // Client idempotency key to prevent double dials
  metadata?: Record<string, unknown>; // CRM contact or lead context
}

/**
 * Normalized Call Session model
 */
export interface CallSessionDto {
  callId: string; // Unified Call Identifier (cs_...)
  provider: TelephonyProvider;
  fromNumber: string;
  toNumber: string;
  state: CallState;
  record: boolean;
  createdAt: string; // ISO timestamp
  answeredAt?: string | null;
  endedAt?: string | null;
  durationSeconds?: number;
  reason?: string | null;
  flowAction?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Call Flow Request DTO passed to telephony services
 */
export interface CallFlowRequestDto {
  callId: string;
  accountId?: string;
  fromNumber: string;
  toNumber: string;
  direction: "inbound" | "outbound";
}

/**
 * Normalized Call Flow Response
 */
export interface CallFlowResponseDto {
  action: "play" | "dial" | "stream" | "hangup";
  mediaUrl?: string;
  dialTo?: string;
  wsUrl?: string;
  rawPayload: Record<string, unknown>;
}

/**
 * Unified Telephony Lifecycle Event
 */
export interface TelephonyEventDto {
  eventId: string;
  eventType: string; // e.g. call.initiated, call.answered, call.completed, call.failed
  callId: string;
  provider: TelephonyProvider;
  occurredAt: string;
  data: Record<string, unknown>;
}
