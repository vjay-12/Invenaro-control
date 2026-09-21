import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().default(3000),

  // Database
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_URL: z.string().optional(),

  // Signing Keys (Ed25519)
  LICENSE_SIGNING_KID: z.string().min(1, "LICENSE_SIGNING_KID is required"),
  LICENSE_SIGNING_PRIVATE_KEY: z
    .string()
    .min(1, "LICENSE_SIGNING_PRIVATE_KEY is required"),
  LICENSE_PUBLIC_KEY: z.string().min(1, "LICENSE_PUBLIC_KEY is required"),
  LICENSE_PUBLIC_JWKS: z.string().optional(),

  // App Behavior
  TOKEN_TTL_HOURS: z.coerce.number().positive().default(48),
  RATE_LIMIT_PER_HOUR: z.coerce.number().positive().default(60),
  ALLOW_LOCALHOST: z
    .string()
    .optional()
    .transform((val) => val === "true" || val === "1"),

  // Admin UI & Authentication
  ADMIN_EMAIL: z.string().email().optional(),
  APP_BASE_URL: z.string().optional().default("http://localhost:3000"),
  ADMIN_ENC_KEY: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  ADMIN_SESSION_IDLE_MINUTES: z.coerce.number().positive().default(30),
  ADMIN_SESSION_ABSOLUTE_HOURS: z.coerce.number().positive().default(12),

  // Email (Nodemailer over Gmail SMTP)
  SMTP_HOST: z.string().default("smtp.gmail.com"),
  SMTP_PORT: z.coerce.number().default(465),
  SMTP_SECURE: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((val) => {
      if (val === false || val === "false" || val === "0") return false;
      return true;
    }),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_ENABLED: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((val) => {
      if (val === true || val === "true" || val === "1") return true;
      if (val === false || val === "false" || val === "0") return false;
      if (process.env.NODE_ENV === "test") return false;
      return process.env.NODE_ENV === "production";
    }),
  EMAIL_FROM_NAME: z.string().default("Invenaro Control"),
}).superRefine((data, ctx) => {
  if (data.NODE_ENV === "production") {
    if (!data.ADMIN_EMAIL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ADMIN_EMAIL is required in production",
        path: ["ADMIN_EMAIL"],
      });
    }
    if (!data.APP_BASE_URL || data.APP_BASE_URL.includes("localhost")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "APP_BASE_URL must be configured to production origin in production",
        path: ["APP_BASE_URL"],
      });
    }
    if (!data.ADMIN_ENC_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ADMIN_ENC_KEY is required in production",
        path: ["ADMIN_ENC_KEY"],
      });
    }
    if (!data.CRON_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CRON_SECRET is required in production",
        path: ["CRON_SECRET"],
      });
    }
    if (data.EMAIL_ENABLED) {
      if (!data.SMTP_USER) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "SMTP_USER is required when EMAIL_ENABLED is true",
          path: ["SMTP_USER"],
        });
      }
      if (!data.SMTP_PASS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "SMTP_PASS is required when EMAIL_ENABLED is true",
          path: ["SMTP_PASS"],
        });
      }
    }
  }

  if (data.ADMIN_ENC_KEY) {
    try {
      const buf = Buffer.from(data.ADMIN_ENC_KEY, "base64");
      if (buf.length !== 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "ADMIN_ENC_KEY must decode to exactly 32 bytes (base64 of AES-256 key)",
          path: ["ADMIN_ENC_KEY"],
        });
      }
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ADMIN_ENC_KEY must be a valid base64 string",
        path: ["ADMIN_ENC_KEY"],
      });
    }
  }

  if (data.APP_BASE_URL) {
    try {
      const u = new URL(data.APP_BASE_URL);
      const normalized = `${u.protocol}//${u.host}`;
      if (data.APP_BASE_URL.replace(/\/$/, "") !== normalized) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "APP_BASE_URL must be origin only (e.g. https://example.vercel.app without path)",
          path: ["APP_BASE_URL"],
        });
      }
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "APP_BASE_URL must be a valid URL origin",
        path: ["APP_BASE_URL"],
      });
    }
  }
});

export type Config = z.infer<typeof envSchema>;

let parsedConfig: Config | null = null;

export function resetConfig(): void {
  parsedConfig = null;
}

export function getConfig(): Config {
  if (parsedConfig && process.env.NODE_ENV !== "test") {
    return parsedConfig;
  }

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errorDetails = result.error.errors
      .map((e) => `  - ${e.path.join(".")}: ${e.message}`)
      .join("\n");
    console.error(`[FATAL] Configuration error:\n${errorDetails}`);
    throw new Error(`Invalid environment configuration:\n${errorDetails}`);
  }

  parsedConfig = result.data;
  return parsedConfig;
}
