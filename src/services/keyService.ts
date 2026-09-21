import crypto from "node:crypto";

/**
 * Crockford's Base32 character set (excludes I, L, O, U to avoid confusion).
 */
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Generates a license key formatted as INV-XXXX-XXXX-XXXX-XXXX-XXXX
 * (5 groups of 4 Crockford Base32 characters = 20 chars = 100 bits of entropy).
 */
export function generateLicenseKey(): string {
  // 20 characters from a 32-character alphabet
  // Each character requires 5 bits of entropy.
  // 20 * 5 = 100 bits = 13 bytes.
  const bytes = crypto.randomBytes(20);
  let chars = "";
  for (let i = 0; i < 20; i++) {
    // Byte modulo 32 gives uniform distribution since 256 % 32 === 0
    chars += CROCKFORD_ALPHABET[bytes[i] % 32];
  }

  // Format into 5 groups of 4 characters
  const groups = [
    chars.slice(0, 4),
    chars.slice(4, 8),
    chars.slice(8, 12),
    chars.slice(12, 16),
    chars.slice(16, 20),
  ];

  return `INV-${groups.join("-")}`;
}

/**
 * Computes SHA-256 hexadecimal hash of the full license key.
 */
export function hashLicenseKey(key: string): string {
  return crypto.createHash("sha256").update(key.trim()).digest("hex");
}

/**
 * Extracts first 8 characters of the license key (e.g. "INV-XXXX") for logging/identification.
 */
export function extractKeyPrefix(key: string): string {
  return key.trim().slice(0, 8);
}

/**
 * Validates whether a given string follows the license key structure.
 */
export function isValidKeyFormat(key: string): boolean {
  const regex = /^INV-[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$/i;
  return regex.test(key.trim());
}
