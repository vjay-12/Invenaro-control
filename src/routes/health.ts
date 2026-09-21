import { Router, Request, Response } from "express";
import { prisma } from "../db.js";

const router = Router();

router.get("/health", async (_req: Request, res: Response) => {
  try {
    // Quick DB connectivity check
    await prisma.$queryRaw`SELECT 1`;

    res.status(200).json({
      status: "ok",
      service: "invenaro-control",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: "degraded",
      service: "invenaro-control",
      timestamp: new Date().toISOString(),
      error: "database_unavailable",
    });
  }
});

export default router;
