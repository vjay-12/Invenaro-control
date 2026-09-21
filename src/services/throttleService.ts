import { prisma } from "../db.js";
import { getConfig } from "../config.js";

export interface ThrottleResult {
  allowed: boolean;
  current: number;
  limit: number;
}

/**
 * Checks and increments the verification throttle for a given key prefix.
 * Enforces a fixed 1-hour window per keyPrefix.
 */
export async function checkThrottle(keyPrefix: string): Promise<ThrottleResult> {
  const config = getConfig();
  const limit = config.RATE_LIMIT_PER_HOUR;

  const now = Date.now();
  const oneHourMs = 60 * 60 * 1000;
  const windowStart = new Date(Math.floor(now / oneHourMs) * oneHourMs);

  try {
    const record = await prisma.verificationThrottle.upsert({
      where: {
        keyPrefix_windowStart: {
          keyPrefix,
          windowStart,
        },
      },
      update: {
        callCount: {
          increment: 1,
        },
      },
      create: {
        keyPrefix,
        windowStart,
        callCount: 1,
      },
    });

    if (record.callCount > limit) {
      return { allowed: false, current: record.callCount, limit };
    }

    return { allowed: true, current: record.callCount, limit };
  } catch (error) {
    // If DB throttle fails, log warning but don't block service availability
    console.error("[Throttle] Failed to execute throttle check:", error);
    return { allowed: true, current: 1, limit };
  }
}
