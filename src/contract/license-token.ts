import { z } from "zod";

export const MODULE_NAMES = [
  "multi_godown",
  "transfers",
  "invoices_returns",
  "payments_dues",
  "stock_control",
  "gst",
  "ledger_ui",
  "reports_advanced",
  "import_export",
  "batch_expiry",
  "barcode",
  "ai_data_assistant",
  "ai_knowledge_assistant",
] as const;

export type ModuleName = (typeof MODULE_NAMES)[number];

export const LICENSE_STATUSES = [
  "active",
  "grace",
  "expired",
  "suspended",
] as const;

export type LicenseStatusType = (typeof LICENSE_STATUSES)[number];

export const LICENSE_PLANS = ["basic", "business", "enterprise"] as const;

export type LicensePlanType = (typeof LICENSE_PLANS)[number];

export const ModulesRecordSchema = z.record(
  z.enum(MODULE_NAMES),
  z.boolean()
);

export type ModulesRecord = Record<ModuleName, boolean>;

/**
 * Payload claims contained inside the Ed25519 signed JWT
 */
export const LicenseTokenClaimsSchema = z.object({
  iss: z.literal("invenaro-control"),
  sub: z.string().min(1), // customerId
  licenseId: z.string().min(1),
  plan: z.enum(LICENSE_PLANS),
  modules: ModulesRecordSchema,
  status: z.enum(LICENSE_STATUSES),
  licenseExpiresAt: z.string().datetime(),
  graceDays: z.number().int().nonnegative(),
  domain: z.string(),
  adminEmail: z.string().email().optional(),
  iat: z.number().int(),
  exp: z.number().int(),
});

export type LicenseTokenClaims = z.infer<typeof LicenseTokenClaimsSchema>;

/**
 * Verification response returned by POST /v1/licenses/verify
 */
export const LicenseVerifyResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string(), // ISO format string of token expiry
  status: z.enum(LICENSE_STATUSES),
});

export type LicenseVerifyResponse = z.infer<typeof LicenseVerifyResponseSchema>;
