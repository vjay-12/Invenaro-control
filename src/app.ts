import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import crypto from "node:crypto";
import healthRouter from "./routes/health.js";
import jwksRouter from "./routes/jwks.js";
import verifyRouter from "./routes/verify.js";
import { adminRouter } from "./admin/routes/adminRouter.js";
import { cronRouter } from "./admin/routes/cron.js";

export function createApp() {
  const app = express();

  // Helmet for security headers
  app.use(helmet());

  // Nonce generation middleware for /admin CSP
  app.use("/admin", (req, res, next) => {
    const nonce = crypto.randomBytes(16).toString("base64");
    res.locals.cspNonce = nonce;
    req.cspNonce = nonce;
    next();
  });

  // Strict CSP specifically configured for /admin
  const adminHelmet = helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        styleSrc: [(req, res) => `'nonce-${(res as Response).locals.cspNonce}'`],
        // Allow inline style attributes (e.g. style="margin: 0;") while keeping style elements nonce-only.
        // Script execution remains strictly nonce-only with zero unsafe-inline.
        styleSrcAttr: ["'unsafe-inline'"],
        scriptSrc: [(req, res) => `'nonce-${(res as Response).locals.cspNonce}'`],
        imgSrc: ["'self'", "data:"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
  });

  app.use("/admin", adminHelmet);

  // Scoped urlencoded body parsing strictly for /admin
  app.use(
    "/admin",
    express.urlencoded({ extended: false, limit: "10kb" })
  );

  // Strict JSON body parsing limit
  app.use(express.json({ limit: "10kb" }));

  // robots.txt disallowing /admin
  app.get("/robots.txt", (_req: Request, res: Response) => {
    res.type("text/plain").send("User-agent: *\nDisallow: /admin\nDisallow: /admin/\n");
  });

  // Mount public API routes
  app.use(healthRouter);
  app.use(jwksRouter);
  app.use(verifyRouter);

  // Mount Admin Cron and Admin Web UI routes
  app.use("/admin/cron", cronRouter);
  app.use("/admin", adminRouter);

  // 404 handler
  app.use((req: Request, res: Response) => {
    if (req.path.startsWith("/admin")) {
      res.status(404).send("Page not found.");
      return;
    }
    res.status(404).json({
      error: "not_found",
      message: "The requested resource was not found.",
    });
  });

  // Global error handler
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    console.error("[Unhandled Error]:", err);

    if (req.path.startsWith("/admin")) {
      res.status(500).send("An unexpected error occurred. Please try again later.");
      return;
    }

    res.status(500).json({
      error: "internal_server_error",
      message: "An unexpected error occurred processing your request.",
    });
  });

  return app;
}

export const app = createApp();

