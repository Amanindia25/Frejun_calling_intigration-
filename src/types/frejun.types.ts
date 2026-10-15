/**
 * FreJun Teler Telephony Types
 * Strictly aligned with FreJun official API documentation:
 * https://frejun.com/docs/teler/
 */

/**
 * Supported Call Flow Actions in FreJun Teler
 */
export type CallFlowActionType = "stream" | "play" | "hangup" | "dial";

/**
 * Call Flow: Play Audio Action
 */
export interface PlayCallFlowAction {
  action: "play";
  media_url: string;
}

/**
 * Call Flow: Dial/Bridge Leg Action (Webhook version 2026-06-01)
 * Used to originate an outbound leg and bridge it into the current call (2-way audio).
 */
export interface DialCallFlowAction {
  action: "dial";
  to: string;
  timeout?: number;
  record?: boolean;
  ringback?: "passthrough" | "ringing";
}

/**
 * Call Flow: Bidirectional Media Streaming Action
 */
export interface StreamCallFlowAction {
  action: "stream";
  ws_url: string;
  chunk_size?: number; // 20 - 2000 ms, divisible by 20. Default 400.
  sample_rate?: "8k" | "16k"; // Default 8k
}

/**
 * Call Flow: Hangup Action
 */
export interface HangupCallFlowAction {
  action: "hangup";
}

/**
 * Union of all valid FreJun Call Flow response actions
 */
export type FreJunCallFlowResponse =
  | PlayCallFlowAction
  | DialCallFlowAction
  | StreamCallFlowAction
  | HangupCallFlowAction;

/**
 * Incoming Call Flow Request payload from FreJun Teler
 * Dispatched to `flow_url` when callee answers.
 */
export interface FreJunCallFlowRequest {
  call_id: string; // cs_<ULID> in 2026-06-01 or UUID in 2025-08-01
  account_id: string; // acc_<ULID> or UUID
  from_number: string; // E.164
  to_number: string; // E.164
  direction: "inbound" | "outbound";
}

/**
 * Raw Outbound Call API Request payload to FreJun API:
 * POST https://api.frejun.ai/api/v1/voice/calls/initiate
 */
export interface FreJunInitiateCallApiRequest {
  from_number: string;
  to_number: string;
  flow_url: string;
  status_callback_url: string;
  record?: boolean;
}

/**
 * Raw Outbound Call API Response from FreJun API
 */
export interface FreJunInitiateCallApiResponse {
  message?: string;
  data: {
    id: string; // cs_<ULID>
    fromNumber?: string;
    from_number?: string;
    toNumber?: string;
    to_number?: string;
    statusCallbackUrl?: string;
    status_callback_url?: string;
    flowUrl?: string;
    flow_url?: string;
    record?: boolean;
  };
}

/**
 * FreJun Webhook Event Types
 */
export type FreJunWebhookEventType =
  | "call.initiated"
  | "call.answered"
  | "call.completed"
  | "call.failed"
  | "stream.initiated"
  | "stream.completed"
  | "recording.completed"
  | "recording.failed";

/**
 * Call Event Data under `data` field of Webhook Envelope (2026-06-01)
 */
export interface FreJunCallEventData {
  call_id: string;
  from: string;
  to: string;
  direction: "inbound" | "outbound";
  start_time: string;
  answered_at?: string | null;
  ended_at?: string | null;
  duration_seconds?: number;
  reason?:
    | "normal"
    | "no_answer"
    | "busy"
    | "canceled"
    | "unreachable"
    | "rejected"
    | "flow_error"
    | "system_failure"
    | string;
  ended_by?: "caller" | "callee" | "system" | null;
  failure?: {
    reason?: string;
    code?: number;
    description?: string;
  };
}

/**
 * FreJun Webhook 2026-06-01 Event Envelope
 */
export interface FreJunWebhookEnvelope<T = FreJunCallEventData> {
  id: string; // evt_<ULID> - Unique event ID stable across retries
  type: FreJunWebhookEventType;
  api_version: "2026-06-01" | string;
  occurred_at: string; // ISO-8601 UTC
  account_id: string;
  voice_app_id: string | null;
  sip_trunk_id: string | null;
  call_id: string; // cs_<ULID>
  leg_id: string | null; // cl_<ULID>
  data: T;
  previous_attributes?: Record<string, unknown> | null;
}
