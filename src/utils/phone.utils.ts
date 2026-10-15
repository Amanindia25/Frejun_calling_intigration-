/**
 * E.164 Phone Number Utilities
 */

// ITU-T E.164 format: + followed by 1 to 3 digit country code and national number (up to 15 digits total)
const E164_REGEX = /^\+[1-9]\d{6,14}$/;

/**
 * Validates whether a phone number strictly matches the E.164 specification.
 */
export function isValidE164(phone: string): boolean {
  if (!phone || typeof phone !== "string") return false;
  return E164_REGEX.test(phone.trim());
}

/**
 * Normalizes phone string by removing whitespace, hyphens, and parentheses.
 * If missing leading '+', prepends default country code if provided.
 */
export function normalizePhoneNumber(phone: string, defaultCountryPrefix = "+91"): string {
  if (!phone) return "";
  let clean = phone.replace(/[\s\-\(\)\.]/g, "").trim();
  if (clean.startsWith("00")) {
    clean = "+" + clean.substring(2);
  } else if (!clean.startsWith("+")) {
    if (clean.length === 10) {
      clean = `${defaultCountryPrefix}${clean}`;
    } else {
      clean = `+${clean}`;
    }
  }
  return clean;
}

/**
 * Masks a phone number for secure logging (e.g., +9198****210)
 */
export function maskPhoneNumber(phone: string): string {
  if (!phone || phone.length < 6) return "***";
  const start = phone.slice(0, 5);
  const end = phone.slice(-3);
  return `${start}****${end}`;
}
