import { LicenseStatusType } from "../contract/license-token.js";

export interface StatusComputationInput {
  customerStatus: "active" | "suspended" | "cancelled" | string;
  licenseStatus: "active" | "suspended" | "revoked" | string;
  expiresAt: Date;
  graceDays: number;
  now?: Date;
}

/**
 * Pure function to compute the effective license status.
 *
 * Rules:
 * 1. Suspended/revoked license or suspended/cancelled customer -> "suspended"
 * 2. now <= expiresAt -> "active"
 * 3. expiresAt < now <= expiresAt + graceDays -> "grace"
 * 4. now > expiresAt + graceDays -> "expired"
 */
export function computeLicenseStatus(input: StatusComputationInput): LicenseStatusType {
  const { customerStatus, licenseStatus, expiresAt, graceDays } = input;
  const now = input.now ?? new Date();

  // Rule 1: Customer or license administrative suspension/revocation
  if (
    customerStatus === "suspended" ||
    customerStatus === "cancelled" ||
    licenseStatus === "suspended" ||
    licenseStatus === "revoked"
  ) {
    return "suspended";
  }

  const nowTime = now.getTime();
  const expiresTime = expiresAt.getTime();

  // Rule 2: Active period
  if (nowTime <= expiresTime) {
    return "active";
  }

  // Calculate end of grace period
  const graceMs = graceDays * 24 * 60 * 60 * 1000;
  const graceEndTime = expiresTime + graceMs;

  // Rule 3: Grace period
  if (nowTime <= graceEndTime) {
    return "grace";
  }

  // Rule 4: Expired
  return "expired";
}
