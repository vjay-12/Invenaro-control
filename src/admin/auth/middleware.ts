import { Request, Response, NextFunction } from "express";
import { prisma } from "../../db.js";
import { getConfig } from "../../config.js";
import {
  parseCookies,
  getSessionCookieName,
  validateAdminSession,
  ValidatedSession,
} from "./session.js";
import { sendAdminEmail, buildAccountLockedEmail } from "../../services/email.js";

declare global {
  namespace Express {
    interface Request {
      adminAuth?: ValidatedSession & {
        clientIp: string;
        csrfToken?: string;
      };
      cspNonce?: string;
    }
  }
}

/**
 * Resolves client IP address following serverless and proxy conventions.
 * Prioritizes x-vercel-forwarded-for, then x-real-ip, then socket remote address.
 */
export function getClientIp(req: Request): string {
  const vercelForwarded = req.headers["x-vercel-forwarded-for"];
  if (typeof vercelForwarded === "string" && vercelForwarded.trim()) {
    return vercelForwarded.split(",")[0].trim();
  }

  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) {
    return realIp.trim();
  }

  const socketIp = req.socket?.remoteAddress;
  if (socketIp) {
    // Strip IPv6-mapped IPv4 prefix
    return socketIp.replace(/^::ffff:/, "");
  }

  return "127.0.0.1";
}

/**
 * Checks Origin and Sec-Fetch-Site headers on state-changing requests (POST).
 */
export function verifyRequestOrigin(req: Request): boolean {
  const origin = req.headers["origin"];
  const secFetchSite = req.headers["sec-fetch-site"];

  // Reject cross-site requests signaled by browser metadata
  if (secFetchSite === "cross-site") {
    return false;
  }

  // If browser explicitly signals same-origin or same-site, allow
  if (secFetchSite === "same-origin" || secFetchSite === "same-site") {
    return true;
  }

  if (origin && typeof origin === "string") {
    const config = getConfig();
    try {
      const originUrl = new URL(origin);

      // In local development or reverse proxy, check matching Host header
      const host = req.headers["host"];
      if (host && originUrl.host === host) {
        return true;
      }

      // Match against configured APP_BASE_URL origin
      if (config.APP_BASE_URL) {
        const appBaseUrl = new URL(config.APP_BASE_URL);
        if (originUrl.origin === appBaseUrl.origin) {
          return true;
        }
      }

      // Allow standard local addresses in development
      if (config.NODE_ENV === "development") {
        if (originUrl.hostname === "localhost" || originUrl.hostname === "127.0.0.1") {
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  return true;
}

/**
 * Enforces rate limiting and account lockout on login attempts.
 * 5 failed attempts within 15 minutes by email or IP locks the account.
 */
export async function checkLoginRateLimitAndLockout(params: {
  email: string;
  ip: string;
}): Promise<{ locked: boolean; message?: string }> {
  const email = params.email.toLowerCase().trim();
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

  // Check if admin is already marked locked
  const admin = await prisma.adminUser.findUnique({
    where: { email },
  });

  if (admin && admin.lockedUntil && admin.lockedUntil > new Date()) {
    return {
      locked: true,
      message: "This account is temporarily locked due to multiple failed login attempts. Please try again later.",
    };
  }

  // Count failed attempts by email
  const failedByEmail = await prisma.adminLoginAttempt.count({
    where: {
      email,
      success: false,
      attemptedAt: { gte: fifteenMinutesAgo },
    },
  });

  // Count failed attempts by IP
  const failedByIp = await prisma.adminLoginAttempt.count({
    where: {
      ip: params.ip,
      success: false,
      attemptedAt: { gte: fifteenMinutesAgo },
    },
  });

  if (failedByEmail >= 5 || failedByIp >= 5) {
    if (admin) {
      const lockUntil = new Date(Date.now() + 15 * 60 * 1000);
      await prisma.adminUser.update({
        where: { id: admin.id },
        data: { lockedUntil: lockUntil },
      });

      const emailPayload = buildAccountLockedEmail({
        email: admin.email,
        ip: params.ip,
      });
      await sendAdminEmail({
        event: "account_locked",
        subject: emailPayload.subject,
        text: emailPayload.text,
        html: emailPayload.html,
        entityType: "AdminUser",
        entityId: admin.id,
      });
    }

    return {
      locked: true,
      message: "Too many failed login attempts. Your account has been temporarily locked for 15 minutes.",
    };
  }

  return { locked: false };
}

/**
 * Checks rate limits on password reset requests (max 3 per hour per IP and per email).
 */
export async function checkForgotRateLimit(params: {
  email: string;
  ip: string;
}): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const email = params.email.toLowerCase().trim();

  const countByIp = await prisma.passwordResetToken.count({
    where: {
      ip: params.ip,
      createdAt: { gte: oneHourAgo },
    },
  });

  if (countByIp >= 3) return false;

  const admin = await prisma.adminUser.findUnique({
    where: { email },
  });

  if (admin) {
    const countByAdmin = await prisma.passwordResetToken.count({
      where: {
        adminId: admin.id,
        createdAt: { gte: oneHourAgo },
      },
    });
    if (countByAdmin >= 3) return false;
  }

  return true;
}

/**
 * Main authentication and stage gating middleware for /admin routes.
 */
export async function adminAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const clientIp = getClientIp(req);
  const cookieName = getSessionCookieName(req);
  const cookies = parseCookies(req.headers.cookie);
  const rawToken = cookies[cookieName];

  // Set mandatory security headers on all /admin responses
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "no-referrer");

  // Origin check on POST requests
  if (req.method === "POST" && !req.path.startsWith("/cron")) {
    if (!verifyRequestOrigin(req)) {
      res.status(403).send("Forbidden: Invalid request origin.");
      return;
    }
  }

  const path = req.path;

  // Public unauthenticated routes
  const isPublicAuthRoute =
    path === "/login" ||
    path.startsWith("/forgot") ||
    path.startsWith("/reset") ||
    path.startsWith("/cron");

  if (!rawToken) {
    if (isPublicAuthRoute) {
      next();
      return;
    }
    // Any other /admin route redirects to login
    res.redirect("/admin/login");
    return;
  }

  const validated = await validateAdminSession(rawToken);

  if (!validated) {
    if (isPublicAuthRoute) {
      next();
      return;
    }
    res.redirect("/admin/login");
    return;
  }

  req.adminAuth = {
    ...validated,
    clientIp,
    csrfToken: validated.session.csrfToken,
  };

  // CSRF verification on authenticated POST requests (excluding logout or public login)
  if (req.method === "POST" && !isPublicAuthRoute) {
    const submittedCsrf = req.body?._csrf;
    if (!submittedCsrf || submittedCsrf !== validated.session.csrfToken) {
      res.status(403).send("Forbidden: Invalid CSRF token.");
      return;
    }
  }

  const { session, admin } = validated;

  // Stage: pending_2fa enforcement
  if (session.stage === "pending_2fa") {
    if (path === "/login/2fa" || path === "/logout") {
      next();
      return;
    }
    res.redirect("/admin/login/2fa");
    return;
  }

  // Force password change flow
  if (admin.mustChangePassword) {
    if (path === "/setup/password" || path === "/setup/2fa" || path === "/logout") {
      next();
      return;
    }
    res.redirect("/admin/setup/password");
    return;
  }

  // Mandatory 2FA enrollment flow
  if (!admin.totpEnabled) {
    if (path === "/setup/2fa" || path === "/logout") {
      next();
      return;
    }
    res.redirect("/admin/setup/2fa");
    return;
  }

  // Logged-in admin trying to access login/forgot -> redirect to dashboard
  if (path === "/login" || path === "/login/2fa" || path === "/forgot" || path.startsWith("/reset")) {
    res.redirect("/admin");
    return;
  }

  next();
}
