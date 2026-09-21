import { Response, Request } from "express";
import { prisma } from "../../db.js";
import { getConfig } from "../../config.js";
import { generateRandomToken, hashToken } from "./crypto.js";
import { AdminUser, AdminSession } from "@prisma/client";

export function getSessionCookieName(req: Request): string {
  const isSecure = req.secure || req.headers["x-forwarded-proto"] === "https";
  const config = getConfig();
  if (config.NODE_ENV === "production" || isSecure) {
    return "__Host-invenaro_admin";
  }
  return "invenaro_admin";
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const list: Record<string, string> = {};
  if (!header) return list;

  header.split(";").forEach((cookie) => {
    const parts = cookie.split("=");
    const key = parts[0]?.trim();
    if (key) {
      list[key] = decodeURIComponent(parts.slice(1).join("=").trim());
    }
  });

  return list;
}

export function setSessionCookie(res: Response, req: Request, token: string) {
  const cookieName = getSessionCookieName(req);
  const isSecure = req.secure || req.headers["x-forwarded-proto"] === "https";
  const config = getConfig();

  res.cookie(cookieName, token, {
    httpOnly: true,
    secure: config.NODE_ENV === "production" || isSecure,
    sameSite: "strict",
    path: "/admin",
    maxAge: config.ADMIN_SESSION_ABSOLUTE_HOURS * 3600 * 1000,
  });
}

export function clearSessionCookie(res: Response, req: Request) {
  const cookieName = getSessionCookieName(req);
  const isSecure = req.secure || req.headers["x-forwarded-proto"] === "https";
  const config = getConfig();

  res.clearCookie(cookieName, {
    httpOnly: true,
    secure: config.NODE_ENV === "production" || isSecure,
    sameSite: "strict",
    path: "/admin",
  });
}

export async function createAdminSession(params: {
  adminId: string;
  stage: "pending_2fa" | "active";
  ip: string;
  userAgent?: string | null;
}): Promise<{ session: AdminSession; rawToken: string }> {
  const config = getConfig();
  const rawToken = generateRandomToken(32);
  const tokenHash = hashToken(rawToken);
  const csrfToken = generateRandomToken(24);

  const now = new Date();
  let idleExpiresAt: Date;
  let absoluteExpiresAt: Date;

  if (params.stage === "pending_2fa") {
    // 5 minutes max for completing 2FA
    idleExpiresAt = new Date(now.getTime() + 5 * 60 * 1000);
    absoluteExpiresAt = new Date(now.getTime() + 5 * 60 * 1000);
  } else {
    idleExpiresAt = new Date(
      now.getTime() + config.ADMIN_SESSION_IDLE_MINUTES * 60 * 1000
    );
    absoluteExpiresAt = new Date(
      now.getTime() + config.ADMIN_SESSION_ABSOLUTE_HOURS * 3600 * 1000
    );
  }

  const session = await prisma.adminSession.create({
    data: {
      adminId: params.adminId,
      tokenHash,
      stage: params.stage,
      csrfToken,
      ip: params.ip,
      userAgent: params.userAgent || null,
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt,
      absoluteExpiresAt,
      attempts: 0,
    },
  });

  return { session, rawToken };
}

export interface ValidatedSession {
  session: AdminSession;
  admin: AdminUser;
}

export async function validateAdminSession(
  rawToken: string
): Promise<ValidatedSession | null> {
  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const session = await prisma.adminSession.findUnique({
    where: { tokenHash },
    include: { admin: true },
  });

  if (!session) {
    return null;
  }

  // Check absolute expiry
  if (now > session.absoluteExpiresAt) {
    await prisma.adminSession.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  // Check idle expiry
  if (now > session.idleExpiresAt) {
    await prisma.adminSession.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  // Check if admin account is currently locked
  if (session.admin.lockedUntil && session.admin.lockedUntil > now) {
    return null;
  }

  // Slide idle expiration window if active session
  if (session.stage === "active") {
    const config = getConfig();
    const newIdle = new Date(
      now.getTime() + config.ADMIN_SESSION_IDLE_MINUTES * 60 * 1000
    );
    await prisma.adminSession.update({
      where: { id: session.id },
      data: {
        lastSeenAt: now,
        idleExpiresAt: newIdle,
      },
    }).catch(() => {});
  }

  return { session, admin: session.admin };
}

export async function rotateAdminSession(
  oldSessionId: string,
  params: {
    adminId: string;
    stage: "pending_2fa" | "active";
    ip: string;
    userAgent?: string | null;
  }
): Promise<{ session: AdminSession; rawToken: string }> {
  // Delete previous session
  await prisma.adminSession.delete({ where: { id: oldSessionId } }).catch(() => {});
  return createAdminSession(params);
}

export async function revokeAllAdminSessions(adminId: string): Promise<void> {
  await prisma.adminSession.deleteMany({
    where: { adminId },
  });
}

export async function revokeOtherAdminSessions(
  adminId: string,
  currentSessionId: string
): Promise<void> {
  await prisma.adminSession.deleteMany({
    where: {
      adminId,
      id: { not: currentSessionId },
    },
  });
}
