import { CallSessionDto, TelephonyEventDto } from "../../types/telephony.types";

export interface ICallRepository {
  create(call: CallSessionDto): Promise<CallSessionDto>;
  update(callId: string, updates: Partial<CallSessionDto>): Promise<CallSessionDto | null>;
  findById(callId: string): Promise<CallSessionDto | null>;
  findActiveByDestination(toNumber: string): Promise<CallSessionDto | null>;
  list(limit?: number): Promise<CallSessionDto[]>;
  saveEvent(event: TelephonyEventDto): Promise<void>;
  getEvents(callId?: string, limit?: number): Promise<TelephonyEventDto[]>;
}
