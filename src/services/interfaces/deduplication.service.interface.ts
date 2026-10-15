export interface IDeduplicationService {
  /**
   * Checks if an outbound call request to the given destination number or with the given idempotency key
   * is currently active or was initiated recently within the cooldown window.
   */
  isDuplicateCall(toNumber: string, idempotencyKey?: string): { isDuplicate: boolean; remainingCooldownMs?: number; activeCallId?: string };

  /**
   * Registers an in-flight call to activate the cooldown and store the idempotency key.
   */
  registerCall(toNumber: string, callId: string, idempotencyKey?: string): void;

  /**
   * Clears the cooldown for a destination (e.g. if call failed immediately).
   */
  clearCallCooldown(toNumber: string, idempotencyKey?: string): void;

  /**
   * Checks whether a webhook event ID (evt_...) has already been received.
   */
  hasSeenWebhookEvent(eventId: string): boolean;

  /**
   * Marks a webhook event ID as processed.
   */
  markWebhookEventProcessed(eventId: string): void;
}
