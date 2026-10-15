import crypto from "node:crypto";
import axios, { AxiosError } from "axios";
import { Client, CallFlow } from "@frejun/teler";
import { ITelephonyService } from "./interfaces/telephony.service.interface";
import {
  CallFlowRequestDto,
  CallFlowResponseDto,
  CallSessionDto,
  InitiateCallDto,
  TelephonyEventDto,
} from "../types/telephony.types";
import {
  FreJunCallFlowResponse,
  FreJunCallEventData,
  FreJunWebhookEnvelope,
  FreJunInitiateCallApiRequest,
  FreJunInitiateCallApiResponse,
} from "../types/frejun.types";
import { IAppConfig } from "../config/app.config";
import { Logger } from "../utils/logger";

export class TelephonyError extends Error {
  public statusCode: number;
  public details?: unknown;

  constructor(message: string, statusCode = 500, details?: unknown) {
    super(message);
    this.name = "TelephonyError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class FreJunService implements ITelephonyService {
  public readonly providerName = "frejun";
  private config: IAppConfig;
  private logger = new Logger("FreJunService");
  private telerClient: Client | null = null;
  private readonly frejunBaseUrl = "https://api.frejun.ai";

  constructor(config: IAppConfig) {
    this.config = config;

    if (config.frejun.apiKey && config.frejun.apiKey !== "YOUR_API_KEY") {
      if (config.frejun.apiKey.includes(".")) {
        this.logger.info("Detected FreJun CRM Dialer API key format; configured for product.frejun.com");
      } else {
        try {
          this.telerClient = new Client(config.frejun.apiKey);
          this.logger.info("Initialized FreJun Teler SDK client");
        } catch (err) {
          this.logger.warn("Could not initialize @frejun/teler SDK directly, will use REST client", {
            err: err instanceof Error ? err.message : err,
          });
        }
      }
    } else {
      this.logger.warn(
        "FREJUN_API_KEY is not configured or is a placeholder. Mock/Simulation mode will activate for API calls if real key is not supplied."
      );
    }
  }

  /**
   * Initiates an outbound call using configured FreJun API
   * Supports both:
   * 1. FreJun CRM Dialer (product.frejun.com / api.frejun.com) via Api-Key
   * 2. FreJun Teler Voice API (frejun.ai / api.frejun.ai) via X-API-Key
   */
  public async initiateCall(dto: InitiateCallDto): Promise<CallSessionDto> {
    const fromNumber = dto.fromNumber || this.config.frejun.callerNumber;
    const toNumber = dto.toNumber;
    const flowUrl = dto.flowUrl || `${this.config.publicBaseUrl}/api/teler/flow`;
    const statusCallbackUrl = dto.statusCallbackUrl || `${this.config.publicBaseUrl}/api/teler/status`;
    const record = dto.record ?? this.config.callSettings.defaultRecord;

    this.logger.info("Initiating outbound call request", {
      fromNumber,
      toNumber,
      record,
    });

    // Handle mock/demo mode if key is placeholder or missing
    if (!this.config.frejun.apiKey || this.config.frejun.apiKey.includes("YOUR_API_KEY") || this.config.frejun.apiKey === "mock-key") {
      this.logger.warn("Executing in SIMULATED/MOCK mode because no real FREJUN_API_KEY was provided.");
      const mockCallId = `cs_mock_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      return {
        callId: mockCallId,
        provider: this.providerName,
        fromNumber,
        toNumber,
        state: "initiated",
        record,
        createdAt: new Date().toISOString(),
        metadata: {
          simulated: true,
          note: "Simulated call. Provide a valid FREJUN_API_KEY in .env for live dialing.",
          ...(dto.metadata || {}),
        },
      };
    }

    // 1. FreJun CRM Dialer Web Portal (product.frejun.com / api.frejun.com)
    // Keys created under product.frejun.com/settings -> Developer have the format: <prefix>.<secret>
    if (this.config.frejun.apiKey.includes(".")) {
      try {
        this.logger.info("Calling FreJun CRM Dialer API (https://api.frejun.com/api/v1/integrations/create-call/)", {
          candidate_number: toNumber,
        });

        const response = await axios.post<{
          success: boolean;
          message: string;
          data?: {
            status?: number;
            info?: string;
            event_id?: number;
            call_id?: string;
            candidate_name?: string;
          };
        }>(
          "https://api.frejun.com/api/v1/integrations/create-call/",
          {
            candidate_number: toNumber,
          },
          {
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Api-Key ${this.config.frejun.apiKey}`,
            },
            timeout: 10000,
          }
        );

        if (response.data && response.data.success) {
          const crmData = response.data.data;
          const callId = crmData?.call_id || `cs_crm_${Date.now()}`;

          this.logger.info("FreJun CRM call initiated successfully", {
            callId,
            eventId: crmData?.event_id,
            info: crmData?.info,
            message: response.data.message,
          });

          return {
            callId,
            provider: this.providerName,
            fromNumber,
            toNumber,
            state: "initiated",
            record,
            createdAt: new Date().toISOString(),
            metadata: {
              source: "product.frejun.com",
              platform: "frejun_crm_dialer",
              eventId: crmData?.event_id,
              info: crmData?.info,
              ...(dto.metadata || {}),
            },
          };
        } else {
          throw new TelephonyError(
            response.data?.message || "FreJun CRM Dialer failed to initiate call",
            400,
            response.data
          );
        }
      } catch (crmError: unknown) {
        if (axios.isAxiosError(crmError) && crmError.response) {
          const status = crmError.response.status;
          const respData = crmError.response.data as any;
          const msg = respData?.message || respData?.detail || crmError.message;
          this.logger.error("FreJun CRM Dialer API request failed", { status, respData });
          throw new TelephonyError(
            `FreJun CRM Dialer Error (${status}): ${typeof msg === "string" ? msg : JSON.stringify(msg)}`,
            status,
            respData
          );
        }
        throw crmError;
      }
    }

    // 2. FreJun Teler SDK / Voice API (frejun.ai / api.frejun.ai)
    if (this.telerClient) {
      try {
        const response = await this.telerClient.voice.calls.create({
          fromNumber,
          toNumber,
          flowUrl,
          statusCallbackUrl,
          record,
        });

        const callId = response.data?.id;
        if (!callId) {
          throw new TelephonyError("FreJun SDK returned empty call ID", 502, response);
        }

        return {
          callId,
          provider: this.providerName,
          fromNumber,
          toNumber,
          state: "initiated",
          record,
          createdAt: new Date().toISOString(),
          metadata: dto.metadata,
        };
      } catch (err: unknown) {
        this.logger.warn("Teler SDK initiation call threw error, attempting REST fallback", {
          error: err instanceof Error ? err.message : err,
        });
      }
    }

    // 3. Direct HTTP REST API invocation (Official Teler endpoint: POST /api/v1/voice/calls/initiate)
    try {
      const payload: FreJunInitiateCallApiRequest = {
        from_number: fromNumber,
        to_number: toNumber,
        flow_url: flowUrl,
        status_callback_url: statusCallbackUrl,
        record,
      };

      const response = await axios.post<FreJunInitiateCallApiResponse>(
        `${this.frejunBaseUrl}/api/v1/voice/calls/initiate`,
        payload,
        {
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": this.config.frejun.apiKey,
          },
          timeout: 10000,
        }
      );

      const data = response.data?.data;
      const callId = data?.id;

      if (!callId) {
        throw new TelephonyError("FreJun API returned successful response without call ID", 502, response.data);
      }

      return {
        callId,
        provider: this.providerName,
        fromNumber,
        toNumber,
        state: "initiated",
        record,
        createdAt: new Date().toISOString(),
        metadata: dto.metadata,
      };
    } catch (error: unknown) {
      this.handleApiError(error);
      throw error;
    }
  }

  /**
   * Retrieves Call status and details from FreJun API
   */
  public async getCall(callId: string): Promise<CallSessionDto | null> {
    if (callId.startsWith("cs_mock_")) {
      return null;
    }

    if (!this.config.frejun.apiKey || this.config.frejun.apiKey === "YOUR_API_KEY") {
      return null;
    }

    try {
      if (this.telerClient) {
        const result = await this.telerClient.voice.calls.retrieve(callId);
        if (result) {
          return {
            callId: (result as any).id || callId,
            provider: this.providerName,
            fromNumber: (result as any).fromNumber || (result as any).from_number || "",
            toNumber: (result as any).toNumber || (result as any).to_number || "",
            state: (result as any).state || "initiated",
            record: (result as any).record ?? true,
            createdAt: (result as any).createdAt || (result as any).created_at || new Date().toISOString(),
            answeredAt: (result as any).answeredAt || (result as any).answered_at,
            endedAt: (result as any).endedAt || (result as any).ended_at,
            reason: (result as any).reason,
          };
        }
      }

      const response = await axios.get(`${this.frejunBaseUrl}/api/v1/voice/calls/${callId}`, {
        headers: {
          "X-API-Key": this.config.frejun.apiKey,
        },
        timeout: 8000,
      });

      const data = response.data?.data || response.data;
      return {
        callId: data.id || callId,
        provider: this.providerName,
        fromNumber: data.from_number || data.fromNumber || "",
        toNumber: data.to_number || data.toNumber || "",
        state: data.state || "initiated",
        record: data.record ?? true,
        createdAt: data.created_at || new Date().toISOString(),
        answeredAt: data.answered_at,
        endedAt: data.ended_at,
        reason: data.reason,
      };
    } catch (err) {
      this.logger.debug("Failed to fetch call details from FreJun API", {
        callId,
        err: err instanceof Error ? err.message : err,
      });
      return null;
    }
  }

  /**
   * Generates Call Flow response when FreJun Teler hits the flow_url.
   * Important: Follows the current official FreJun documentation for exact Call Flow JSON structure.
   */
  public generateCallFlow(request: CallFlowRequestDto): CallFlowResponseDto {
    const action = this.config.frejun.flowAction;
    this.logger.info("Generating Call Flow response for answered call", {
      callId: request.callId,
      action,
      toNumber: request.toNumber,
    });

    let rawPayload: Record<string, unknown>;

    switch (action) {
      case "dial": {
        // Two-way audio bridge: originates an outbound leg to an agent or bridge target
        const targetNumber = this.config.frejun.dialBridgeTarget || request.fromNumber;
        rawPayload = CallFlow.dial(targetNumber) as unknown as Record<string, unknown>;
        return {
          action: "dial",
          dialTo: targetNumber,
          rawPayload,
        };
      }

      case "stream": {
        // Bidirectional WebSocket stream for AI voice bot or WebRTC bridge
        const wsUrl = `${this.config.publicBaseUrl.replace(/^http/, "ws")}/media-stream`;
        rawPayload = CallFlow.stream(wsUrl, { chunkSize: 400, sampleRate: "8k" }) as unknown as Record<string, unknown>;
        return {
          action: "stream",
          wsUrl,
          rawPayload,
        };
      }

      case "hangup": {
        rawPayload = CallFlow.hangup() as unknown as Record<string, unknown>;
        return {
          action: "hangup",
          rawPayload,
        };
      }

      case "play":
      default: {
        // Plays an announcement audio file and hangs up
        const mediaUrl = this.config.frejun.flowMediaUrl;
        rawPayload = CallFlow.play(mediaUrl) as unknown as Record<string, unknown>;
        return {
          action: "play",
          mediaUrl,
          rawPayload,
        };
      }
    }
  }

  /**
   * Webhook Signature Verification per FreJun documentation:
   * Header: X-Teler-Timestamp (epoch seconds)
   * Header: X-Teler-Signature (HMAC-SHA256 hex string)
   * Expected: HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
   */
  public verifyWebhookSignature(rawBody: Buffer, timestamp: string, signature: string): boolean {
    const secret = this.config.frejun.webhookSecret;

    // Permissive mode for local development if secret is not configured
    if (!secret || secret === "YOUR_WEBHOOK_SECRET") {
      this.logger.warn(
        "FREJUN_WEBHOOK_SECRET is not configured. Webhook signature check is running in development fallback mode."
      );
      return true;
    }

    if (!timestamp || !signature || !rawBody) {
      this.logger.warn("Missing timestamp, signature, or rawBody for webhook verification");
      return false;
    }

    // 1. Replay attack prevention (reject events outside tolerance window)
    const eventTime = Number(timestamp);
    const now = Math.floor(Date.now() / 1000);
    const diff = Math.abs(now - eventTime);
    if (isNaN(eventTime) || diff > this.config.frejun.webhookToleranceSeconds) {
      this.logger.warn("Webhook rejected: timestamp outside tolerance window", {
        timestamp,
        now,
        diffSeconds: diff,
        toleranceSeconds: this.config.frejun.webhookToleranceSeconds,
      });
      return false;
    }

    try {
      // 2. Compute expected HMAC-SHA256 digest over `${timestamp}.${raw_body_bytes}`
      const msg = Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]);
      const expectedSignature = crypto
        .createHmac("sha256", secret)
        .update(msg)
        .digest("hex");

      // 3. Constant-time comparison
      if (signature.length !== expectedSignature.length) {
        this.logger.warn("Webhook signature length mismatch", {
          receivedLength: signature.length,
          expectedLength: expectedSignature.length,
        });
        return false;
      }

      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature, "utf-8"),
        Buffer.from(expectedSignature, "utf-8")
      );

      if (!isValid) {
        this.logger.warn("Webhook signature invalid");
      }

      return isValid;
    } catch (err) {
      this.logger.error("Error during webhook signature verification", err);
      return false;
    }
  }

  /**
   * Parses webhook payload (handles both 2026-06-01 envelope and legacy flat body)
   */
  public parseWebhookEvent(body: unknown): TelephonyEventDto {
    const b = body as Record<string, unknown>;

    // 2026-06-01 Webhook Envelope format
    if (b && typeof b.id === "string" && typeof b.type === "string") {
      const envelope = b as unknown as FreJunWebhookEnvelope<FreJunCallEventData>;
      return {
        eventId: envelope.id,
        eventType: envelope.type,
        callId: envelope.call_id || envelope.data?.call_id || "",
        provider: this.providerName,
        occurredAt: envelope.occurred_at || new Date().toISOString(),
        data: (envelope.data as unknown as Record<string, unknown>) || {},
      };
    }

    // Legacy (2025-08-01) flat format fallback
    const legacyEvent = (b.event as string) || (b.type as string) || "unknown";
    const legacyData = (b.data as Record<string, unknown>) || b;
    const callId = (legacyData.call_id as string) || (b.call_id as string) || "";
    const eventId = `evt_legacy_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    return {
      eventId,
      eventType: legacyEvent,
      callId,
      provider: this.providerName,
      occurredAt: (legacyData.start_time as string) || new Date().toISOString(),
      data: legacyData,
    };
  }

  /**
   * Maps FreJun Teler error responses to typed TelephonyError with helpful CRM actionable messages
   */
  private handleApiError(error: unknown): void {
    if (axios.isAxiosError(error)) {
      const err = error as AxiosError<{ message?: string; error?: string; detail?: string }>;
      const status = err.response?.status || 500;
      const respData = err.response?.data;
      const msg = respData?.message || respData?.error || respData?.detail || err.message;

      this.logger.error("FreJun Teler API request failed", err, {
        status,
        response: respData,
      });

      if (status === 403) {
        throw new TelephonyError(
          `FreJun Authentication Failed (403): Invalid API Key. Please verify FREJUN_API_KEY. ${msg}`,
          403,
          respData
        );
      }

      if (status === 422) {
        throw new TelephonyError(
          `FreJun Validation Failed (422): Missing or invalid parameters in outbound call request. ${msg}`,
          422,
          respData
        );
      }

      if (status === 502 || status === 504) {
        throw new TelephonyError(
          `FreJun Call Origination Failed (${status}): Carrier/routing timeout or caller number not provisioned on your FreJun account. ${msg}`,
          status,
          respData
        );
      }

      throw new TelephonyError(`FreJun Telephony Error (${status}): ${msg}`, status, respData);
    }
  }
}
