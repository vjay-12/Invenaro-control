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
});

export type Config = z.infer<typeof envSchema>;

let parsedConfig: Config | null = null;

export function getConfig(): Config {
  if (parsedConfig) {
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
