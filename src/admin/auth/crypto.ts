import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { getConfig } from "../../config.js";

// Dummy bcrypt hash for missing-user logins to thwart timing attacks
const DUMMY_BCRYPT_HASH =
  "$2a$12$e8kG61K0WfXgL2rE5H4F2.qO8y5Bq5YvG/KkQJ8vYv9b8a0p7z6/m";

const COMMON_PASSWORDS = new Set([
  "password1234",
  "123456789012",
  "admin1234567",
  "qwerty123456",
  "administrator",
  "changeme1234",
  "welcome12345",
  "invenaro1234",
  "correcthorsebatterystaple",
]);

export function validatePasswordPolicy(password: string, email: string): {
  valid: boolean;
  message?: string;
} {
  if (password.length < 12) {
    return { valid: false, message: "Password must be at least 12 characters long." };
  }
  if (password.toLowerCase() === email.toLowerCase()) {
    return { valid: false, message: "Password cannot be the same as your email address." };
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { valid: false, message: "This password is too common and easily guessed." };
  }
  return { valid: true };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function dummyComparePassword(password: string): Promise<boolean> {
  return bcrypt.compare(password, DUMMY_BCRYPT_HASH);
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token.trim()).digest("hex");
}

export function generateRandomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}

/**
 * Encrypts a string (e.g. TOTP secret) using AES-256-GCM and ADMIN_ENC_KEY.
 */
export function encryptAesGcm(plainText: string, base64Key?: string): string {
  const keyBase64 = base64Key || getConfig().ADMIN_ENC_KEY;
  if (!keyBase64) {
    throw new Error("ADMIN_ENC_KEY is not configured for AES-256-GCM encryption.");
  }

  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error("ADMIN_ENC_KEY must decode to exactly 32 bytes.");
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  let encrypted = cipher.update(plainText, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypts a string previously encrypted with AES-256-GCM.
 */
export function decryptAesGcm(cipherPayload: string, base64Key?: string): string {
  const keyBase64 = base64Key || getConfig().ADMIN_ENC_KEY;
  if (!keyBase64) {
    throw new Error("ADMIN_ENC_KEY is not configured for AES-256-GCM decryption.");
  }

  const parts = cipherPayload.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted payload format.");
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = Buffer.from(keyBase64, "base64");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
