import {
  CallFlowRequestDto,
  CallFlowResponseDto,
  CallSessionDto,
  InitiateCallDto,
  TelephonyEventDto,
} from "../../types/telephony.types";

export interface ITelephonyService {
  /**
   * The provider identifier (e.g., 'frejun')
   */
  readonly providerName: string;

  /**
   * Initiates an outbound call to the target phone number.
   */
  initiateCall(dto: InitiateCallDto): Promise<CallSessionDto>;

  /**
   * Retrieves current status and details of a call from the provider.
   */
  getCall(callId: string): Promise<CallSessionDto | null>;

  /**
   * Generates instructions (Call Flow) when callee answers and provider hits flow_url.
   */
  generateCallFlow(request: CallFlowRequestDto): CallFlowResponseDto;

  /**
   * Verifies the authenticity of an incoming webhook using HMAC signature.
   */
  verifyWebhookSignature(rawBody: Buffer, timestamp: string, signature: string): boolean;

  /**
   * Parses an incoming webhook payload into a normalized telephony lifecycle event.
   */
  parseWebhookEvent(body: unknown): TelephonyEventDto;
}
