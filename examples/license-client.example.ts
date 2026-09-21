/**
 * Reference License Client for the Invenaro App repository.
 *
 * Copy this file along with `src/contract/license-token.ts` into your app repo.
 *
 * Required Environment Variables in the app:
 * - LICENSE_KEY: e.g. "INV-XXXX-XXXX-XXXX-XXXX-XXXX"
 * - LICENSE_PUBLIC_KEY: Base64-encoded SPKI Ed25519 public key
 * - LICENSE_SERVICE_URL: e.g. "https://license.invenaro.com"
 * - APP_DOMAIN: e.g. "acme.invenaro.com"
 * - APP_VERSION: e.g. "1.0.0"
 */

import * as jose from "jose";
import {
  LicenseTokenClaims,
  LicenseTokenClaimsSchema,
  LicenseVerifyResponseSchema,
  ModuleName,
} from "../src/contract/license-token.js";

// Cached in memory between cold invocations
let cachedPublicKey: jose.KeyLike | null = null;

function decodePem(keyOrBase64: string): string {
  const trimmed = keyOrBase64.trim();
  if (trimmed.startsWith("-----BEGIN")) {
    return trimmed;
  }
  return Buffer.from(trimmed, "base64").toString("utf8");
}

async function getPublicKey(): Promise<jose.KeyLike> {
  if (cachedPublicKey) {
    return cachedPublicKey;
  }

  const rawKey = process.env.LICENSE_PUBLIC_KEY;
  if (!rawKey) {
    throw new Error("LICENSE_PUBLIC_KEY environment variable is not configured");
  }

  const pem = decodePem(rawKey);
  cachedPublicKey = (await jose.importSPKI(pem, "EdDSA")) as jose.KeyLike;
  return cachedPublicKey;
}

/**
 * Verifies and parses a raw JWT string using the Ed25519 public key.
 */
export async function verifyTokenSignature(
  rawToken: string
): Promise<LicenseTokenClaims> {
  const publicKey = await getPublicKey();

  const { payload } = await jose.jwtVerify(rawToken, publicKey, {
    issuer: "invenaro-control",
    algorithms: ["EdDSA"],
  });

  // Validate that claims conform strictly to the expected schema
  return LicenseTokenClaimsSchema.parse(payload);
}

/**
 * Fetches a fresh license token from invenaro-control.
 */
export async function fetchFreshLicenseToken(): Promise<string> {
  const serviceUrl = process.env.LICENSE_SERVICE_URL || "https://license.invenaro.com";
  const licenseKey = process.env.LICENSE_KEY;
  const domain = process.env.APP_DOMAIN || "localhost";
  const appVersion = process.env.APP_VERSION || "1.0.0";

  if (!licenseKey) {
    throw new Error("LICENSE_KEY environment variable is missing");
  }

  const response = await fetch(`${serviceUrl}/v1/licenses/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      licenseKey,
      domain,
      appVersion,
    }),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new Error(
      `License verification failed [HTTP ${response.status}]: ${
        errorBody.error || "unknown_error"
      } - ${errorBody.message || response.statusText}`
    );
  }

  const data = LicenseVerifyResponseSchema.parse(await response.json());
  return data.token;
}

/**
 * Example App DB adapter interface.
 * Replace with your actual App database client (e.g. Prisma).
 */
export interface LicenseCacheStore {
  getCachedToken(): Promise<string | null>;
  setCachedToken(token: string): Promise<void>;
}

/**
 * High-level function called on server startup, cron, or request middleware.
 * Resolves claims from cached token if valid; otherwise refreshes via API.
 */
export async function getEffectiveLicense(
  store: LicenseCacheStore
): Promise<LicenseTokenClaims> {
  const cachedRaw = await store.getCachedToken();

  if (cachedRaw) {
    try {
      const claims = await verifyTokenSignature(cachedRaw);
      const nowSeconds = Math.floor(Date.now() / 1000);

      // If token still valid with at least 1 hour safety margin, return it
      if (claims.exp - nowSeconds > 3600) {
        return claims;
      }
    } catch {
      // Signature invalid or expired; fall through to refresh
    }
  }

  // Refresh token from control server
  const freshRaw = await fetchFreshLicenseToken();
  const freshClaims = await verifyTokenSignature(freshRaw);

  // Save to customer App DB
  await store.setCachedToken(freshRaw);

  return freshClaims;
}

/**
 * Express middleware helper to enforce module access.
 * Returns 403 Forbidden if the requested module is not enabled in the active license.
 */
export function requireModule(moduleName: ModuleName) {
  return (
    req: { licenseClaims?: LicenseTokenClaims },
    res: { status: (code: number) => { json: (body: unknown) => void } },
    next: () => void
  ) => {
    const claims = req.licenseClaims;

    if (!claims) {
      return res.status(500).json({
        error: "license_not_loaded",
        message: "License claims not attached to request context",
      });
    }

    if (claims.status === "suspended") {
      return res.status(403).json({
        error: "license_suspended",
        message: "This deployment license has been administratively suspended.",
      });
    }

    const isEnabled = claims.modules[moduleName] === true;
    if (!isEnabled) {
      return res.status(403).json({
        error: "module_disabled",
        message: `The '${moduleName}' module is not included in your current '${claims.plan}' plan.`,
      });
    }

    next();
  };
}

/**
 * Express middleware helper to enforce read-only state when license is expired.
 */
export function enforceWriteProtection() {
  return (
    req: { method: string; licenseClaims?: LicenseTokenClaims },
    res: { status: (code: number) => { json: (body: unknown) => void } },
    next: () => void
  ) => {
    const claims = req.licenseClaims;
    if (!claims) return next();

    const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method.toUpperCase());

    if (claims.status === "expired" && isWrite) {
      return res.status(403).json({
        error: "license_expired_read_only",
        message:
          "Your license subscription and grace period have expired. Your deployment is in read-only mode.",
      });
    }

    next();
  };
}
