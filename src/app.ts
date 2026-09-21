import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import healthRouter from "./routes/health.js";
import jwksRouter from "./routes/jwks.js";
import verifyRouter from "./routes/verify.js";

export function createApp() {
  const app = express();

  // Helmet for security headers
  app.use(helmet());

  // Strict body parsing limit
  app.use(express.json({ limit: "10kb" }));

  // Mount routes
  app.use(healthRouter);
  app.use(jwksRouter);
  app.use(verifyRouter);

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: "not_found",
      message: "The requested resource was not found.",
    });
  });

  // Global error handler
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[Unhandled Error]:", err);

    res.status(500).json({
      error: "internal_server_error",
      message: "An unexpected error occurred processing your request.",
    });
  });

  return app;
}

export const app = createApp();
