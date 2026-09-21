import { prisma } from "../db.js";
import { getConfig } from "../config.js";
import {
  hashLicenseKey,
  extractKeyPrefix,
  isValidKeyFormat,
} from "./keyService.js";
import { computeLicenseStatus } from "./statusLogic.js";
import { computeEffectiveModules } from "./planDefaults.js";
import { signLicenseToken } from "./tokenService.js";
import { checkThrottle } from "./throttleService.js";
import { LicensePlanType } from "../contract/license-token.js";

export class VerifyError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorCode: string,
    message: string
  ) {
    super(message);
    this.name = "VerifyError";
  }
}

export interface VerifyInput {
  licenseKey: string;
  domain: string;
  appVersion: string;
}

export interface VerifyOutput {
  token: string;
  expiresAt: string;
  status: string;
}

/**
 * Handles license verification:
 * 1. Validates key format and enforces per-key rate limits
 * 2. Hashes key and retrieves license and customer
 * 3. Enforces domain restrictions
 * 4. Computes status (active, grace, expired, suspended)
 * 5. Generates signed Ed25519 JWT token
 * 6. Updates deployment lastSeenAt and appVersion
 */
export async function verifyLicense(input: VerifyInput): Promise<VerifyOutput> {
  const config = getConfig();
  const trimmedKey = input.licenseKey?.trim() ?? "";
  const trimmedDomain = input.domain?.trim().toLowerCase() ?? "";
  const trimmedVersion = input.appVersion?.trim() ?? "unknown";

  // 1. Validate key format (return generic invalid_key to avoid leaking details)
  if (!trimmedKey || !isValidKeyFormat(trimmedKey)) {
    throw new VerifyError(401, "invalid_key", "The provided license key is invalid or unrecognized.");
  }

  const keyPrefix = extractKeyPrefix(trimmedKey);

  // 2. Throttle check per key prefix
  const throttle = await checkThrottle(keyPrefix);
  if (!throttle.allowed) {
    throw new VerifyError(
      429,
      "rate_limited",
      `Rate limit exceeded. Maximum ${throttle.limit} verification requests allowed per hour.`
    );
  }

  // 3. Hash key and look up license
  const keyHash = hashLicenseKey(trimmedKey);
  const license = await prisma.license.findUnique({
    where: { keyHash },
    include: {
      customer: {
        include: {
          deployments: true,
        },
      },
      modules: true,
    },
  });

  if (!license) {
    // Uniform response for unknown keys
    throw new VerifyError(401, "invalid_key", "The provided license key is invalid or unrecognized.");
  }

  // 4. Domain check
  const isLocalhost =
    trimmedDomain === "localhost" ||
    trimmedDomain.startsWith("localhost:") ||
    trimmedDomain === "127.0.0.1" ||
    trimmedDomain.startsWith("127.0.0.1:");

  // Find deployment that matches domain or allowedDomains
  const deployments = license.customer.deployments;
  const deploymentWithRestrictions = deployments.find(
    (d) => d.allowedDomains && d.allowedDomains.length > 0
  );

  if (deploymentWithRestrictions) {
    const isAllowedLocalhost = isLocalhost && Boolean(config.ALLOW_LOCALHOST);
    const domainIsAllowed = deploymentWithRestrictions.allowedDomains
      .map((d) => d.toLowerCase())
      .includes(trimmedDomain);

    if (!domainIsAllowed && !isAllowedLocalhost) {
      throw new VerifyError(
        403,
        "domain_mismatch",
        `Domain '${trimmedDomain}' is not authorized for this deployment.`
      );
    }
  }

  // 5. Compute status & effective modules
  const status = computeLicenseStatus({
    customerStatus: license.customer.status,
    licenseStatus: license.status,
    expiresAt: license.expiresAt,
    graceDays: license.graceDays,
  });

  const effectiveModules = computeEffectiveModules(
    license.plan as LicensePlanType,
    license.modules
  );

  // 6. Sign JWT token (returns token and token expiration ISO)
  const { token, expiresAtIso } = await signLicenseToken({
    sub: license.customerId,
    licenseId: license.id,
    plan: license.plan as LicensePlanType,
    modules: effectiveModules,
    status,
    licenseExpiresAt: license.expiresAt.toISOString(),
    graceDays: license.graceDays,
    domain: trimmedDomain,
  });

  // 7. Update deployment record asynchronously (fail-safe)
  try {
    const matchingDeployment =
      deployments.find((d) => d.domain.toLowerCase() === trimmedDomain) ||
      deployments[0];

    if (matchingDeployment) {
      await prisma.deployment.update({
        where: { id: matchingDeployment.id },
        data: {
          lastSeenAt: new Date(),
          appVersion: trimmedVersion,
          ...(matchingDeployment.domain !== trimmedDomain && !matchingDeployment.domain
            ? { domain: trimmedDomain }
            : {}),
        },
      });
    } else {
      // Create new deployment record for this customer
      await prisma.deployment.create({
        data: {
          customerId: license.customerId,
          domain: trimmedDomain,
          appVersion: trimmedVersion,
          lastSeenAt: new Date(),
          allowedDomains: [],
        },
      });
    }
  } catch (err) {
    // Do not fail verification if updating deployment stats fails
    console.error("[Deployment] Failed to update deployment metadata:", err);
  }

  return {
    token,
    expiresAt: expiresAtIso,
    status,
  };
}
