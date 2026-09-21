import { Router, Request, Response } from "express";
import crypto from "node:crypto";
import { prisma } from "../../db.js";
import { getConfig } from "../../config.js";
import { sendAdminEmail, escapeHtml } from "../../services/email.js";
import { computeLicenseStatus } from "../../services/statusLogic.js";

export const cronRouter = Router();

function timingSafeTokenCompare(providedHeader: string | undefined, secret: string | undefined): boolean {
  if (!providedHeader || !secret) return false;
  const expected = `Bearer ${secret}`;

  const providedBuf = Buffer.from(providedHeader, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");

  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

// POST /admin/cron/cleanup or GET /admin/cron/cleanup (Vercel crons send GET)
const handleCleanup = async (req: Request, res: Response) => {
  const config = getConfig();

  if (!config.CRON_SECRET) {
    console.error("[Cron] CRON_SECRET is not configured.");
    res.status(500).json({ error: "cron_secret_unconfigured" });
    return;
  }

  const authHeader = req.headers["authorization"];
  if (!timingSafeTokenCompare(authHeader, config.CRON_SECRET)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // 1. Prune expired sessions
  const sessionsResult = await prisma.adminSession.deleteMany({
    where: {
      OR: [
        { idleExpiresAt: { lt: now } },
        { absoluteExpiresAt: { lt: now } },
      ],
    },
  });

  // 2. Prune used or expired password reset tokens
  const resetTokensResult = await prisma.passwordResetToken.deleteMany({
    where: {
      OR: [
        { usedAt: { not: null } },
        { expiresAt: { lt: now } },
      ],
    },
  });

  // 3. Prune login attempts older than 24 hours
  const loginAttemptsResult = await prisma.adminLoginAttempt.deleteMany({
    where: {
      attemptedAt: { lt: twentyFourHoursAgo },
    },
  });

  // 4. Prune verification throttles older than 24 hours
  const throttlesResult = await prisma.verificationThrottle.deleteMany({
    where: {
      windowStart: { lt: twentyFourHoursAgo },
    },
  });

  // 5. Prune old notifications (> 30 days)
  const notificationsResult = await prisma.notification.deleteMany({
    where: {
      createdAt: { lt: thirtyDaysAgo },
    },
  });

  // 6. Daily Digest Check (Licenses expiring within 14 days, deployments silent > 3 days)
  let digestSent = false;
  const fourteenDaysFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

  const [expiringLicenses, silentDeployments] = await Promise.all([
    prisma.license.findMany({
      where: {
        expiresAt: {
          gt: now,
          lte: fourteenDaysFromNow,
        },
      },
      include: { customer: true },
    }),
    prisma.deployment.findMany({
      where: {
        OR: [
          { lastSeenAt: null },
          { lastSeenAt: { lt: threeDaysAgo } },
        ],
      },
      include: { customer: true },
    }),
  ]);

  const activeExpiring = expiringLicenses.filter((l) => {
    const status = computeLicenseStatus({
      customerStatus: l.customer.status,
      licenseStatus: l.status,
      expiresAt: l.expiresAt,
      graceDays: l.graceDays,
      now,
    });
    return status === "active" || status === "grace";
  });

  if (activeExpiring.length > 0 || silentDeployments.length > 0) {
    const title = `Daily Digest: ${activeExpiring.length} Expiring Licenses, ${silentDeployments.length} Silent Deployments`;
    let body = `<h3>Daily System Digest</h3>`;

    if (activeExpiring.length > 0) {
      body += `<h4>Licenses Expiring Soon (&lt; 14 days):</h4><ul>`;
      for (const l of activeExpiring) {
        body += `<li><strong>${escapeHtml(l.customer.companyName)}</strong> (${escapeHtml(l.plan)}): expires ${l.expiresAt.toISOString().slice(0, 10)}</li>`;
      }
      body += `</ul>`;
    }

    if (silentDeployments.length > 0) {
      body += `<h4>Silent Deployments (&gt; 3 days inactive):</h4><ul>`;
      for (const d of silentDeployments) {
        body += `<li><strong>${escapeHtml(d.customer.companyName)}</strong> (${escapeHtml(d.domain)}): last seen ${d.lastSeenAt ? d.lastSeenAt.toISOString().slice(0, 10) : "never"}</li>`;
      }
      body += `</ul>`;
    }

    await sendAdminEmail({
      event: "daily_digest",
      subject: title,
      text: title,
      html: body,
    });
    digestSent = true;
  }

  res.json({
    success: true,
    deleted: {
      sessions: sessionsResult.count,
      resetTokens: resetTokensResult.count,
      loginAttempts: loginAttemptsResult.count,
      throttles: throttlesResult.count,
      notifications: notificationsResult.count,
    },
    digestSent,
  });
};

cronRouter.get("/cleanup", handleCleanup);
cronRouter.post("/cleanup", handleCleanup);
