import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import crypto from "node:crypto";
import { hashToken } from "./crypto.js";

/**
 * Generates a new random TOTP secret in Crockford Base32.
 */
export function generateTotpSecret(): string {
  const secret = new OTPAuth.Secret({ size: 20 });
  return secret.base32;
}

/**
 * Builds the otpauth:// URI for authenticator apps.
 */
export function getTotpUri(secretBase32: string, email: string): string {
  const totp = new OTPAuth.TOTP({
    issuer: "Invenaro Control",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  return totp.toString();
}

/**
 * Generates an inline QR code image data URI (SVG/PNG data:image/png;base64,...).
 */
export async function generateQrCodeDataUri(uri: string): Promise<string> {
  return QRCode.toDataURL(uri, {
    margin: 2,
    width: 256,
    color: {
      dark: "#000000",
      light: "#ffffff",
    },
  });
}

export interface TotpVerificationResult {
  valid: boolean;
  timeStep?: number;
}

/**
 * Validates a 6-digit TOTP code against the secret (allowing 1 step drift = +/- 30s)
 * with replay protection preventing reuse of previously verified time steps.
 */
export function verifyTotpCodeWithReplay(
  secretBase32: string,
  token: string,
  lastTimeStep?: number | bigint | null
): TotpVerificationResult {
  const totp = new OTPAuth.TOTP({
    issuer: "Invenaro Control",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });

  const delta = totp.validate({
    token: token.trim(),
    window: 1,
  });

  if (delta === null) {
    return { valid: false };
  }

  const currentStep = Math.floor(Date.now() / 1000 / 30);
  const validatedStep = currentStep + delta;

  if (lastTimeStep !== undefined && lastTimeStep !== null && BigInt(validatedStep) <= BigInt(lastTimeStep)) {
    return { valid: false };
  }

  return { valid: true, timeStep: validatedStep };
}

/**
 * Validates a 6-digit TOTP code against the secret (allowing 1 step drift = +/- 30s).
 */
export function verifyTotpCode(
  secretBase32: string,
  token: string,
  lastTimeStep?: number | bigint | null
): boolean {
  return verifyTotpCodeWithReplay(secretBase32, token, lastTimeStep).valid;
}

/**
 * Generates 10 single-use recovery codes and their SHA-256 hashes.
 */
export function generateRecoveryCodes(): {
  plainCodes: string[];
  codeHashes: string[];
} {
  const plainCodes: string[] = [];
  const codeHashes: string[] = [];

  for (let i = 0; i < 10; i++) {
    // Generate 12 hex characters formatted as XXXX-XXXX-XXXX
    const raw = crypto.randomBytes(6).toString("hex").toUpperCase();
    const formatted = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
    plainCodes.push(formatted);
    codeHashes.push(hashToken(formatted));
  }

  return { plainCodes, codeHashes };
}

/**
 * Verifies if the provided code matches any unused recovery code hash.
 * If valid, returns the remaining hashes without the used code.
 */
export function verifyAndConsumeRecoveryCode(
  providedCode: string,
  storedHashes: string[]
): { valid: boolean; remainingHashes: string[] } {
  const normalized = providedCode.trim().toUpperCase();
  const inputHash = hashToken(normalized);

  const index = storedHashes.indexOf(inputHash);
  if (index === -1) {
    return { valid: false, remainingHashes: storedHashes };
  }

  const remainingHashes = [
    ...storedHashes.slice(0, index),
    ...storedHashes.slice(index + 1),
  ];

  return { valid: true, remainingHashes };
}
