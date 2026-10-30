import { prisma } from "../db.js";
import { redactSecrets } from "./secretRedact.js";

export async function writeAudit(opts: {
  userId?: string | null;
  featureRunId?: string | null;
  action: string;
  detail?: string;
  meta?: Record<string, unknown>;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: opts.userId || null,
        featureRunId: opts.featureRunId || null,
        action: opts.action.slice(0, 120),
        detail: opts.detail ? redactSecrets(opts.detail).slice(0, 8000) : null,
        metaJson: (opts.meta || {}) as object,
      },
    });
  } catch {
    /* never break pipeline for audit */
  }
}
