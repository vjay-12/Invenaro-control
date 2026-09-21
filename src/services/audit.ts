import { prisma } from "../db.js";
import { Prisma } from "@prisma/client";

export interface CreateAuditLogParams {
  actor?: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
}

/**
 * Resolves current actor from environment if not explicitly provided.
 */
export function getCurrentActor(): string {
  return (
    process.env.USER ||
    process.env.USERNAME ||
    process.env.LOGNAME ||
    "invenaro-admin"
  );
}

/**
 * Records an entry in the audit_logs table.
 */
export async function recordAuditLog(params: CreateAuditLogParams) {
  const actor = params.actor || getCurrentActor();

  return prisma.auditLog.create({
    data: {
      actor,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      before:
        params.before === undefined || params.before === null
          ? Prisma.JsonNull
          : params.before,
      after:
        params.after === undefined || params.after === null
          ? Prisma.JsonNull
          : params.after,
    },
  });
}
