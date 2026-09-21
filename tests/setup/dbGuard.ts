import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

/**
 * Database Safety Guard for Vitest.
 * Ensures that any test suite that interacts with Prisma/PostgreSQL executes ONLY
 * against an isolated test database (e.g. Neon "test" branch), NEVER against DEV or PROD.
 */
export function enforceDatabaseSafetyGuard(testPath?: string): void {
  const currentFile = testPath || "";
  const isDbTest =
    currentFile.includes("adminAuth.test.ts") ||
    currentFile.includes("adminActions.test.ts") ||
    currentFile.includes("adminCron.test.ts") ||
    process.env.VITEST_DB_TESTS === "true";

  // Pure unit tests do not touch the database; skip enforcement
  if (!isDbTest) {
    return;
  }

  const envTestPath = path.resolve(process.cwd(), ".env.test");
  if (!fs.existsSync(envTestPath)) {
    throw new Error(
      `\n================================================================================\n` +
      `[DATABASE SAFETY GUARD FATAL ERROR]\n` +
      `File .env.test does not exist!\n` +
      `DB-backed tests (adminAuth, adminActions, adminCron) execute destructive\n` +
      `table wipe operations and CANNOT run against development or production.\n\n` +
      `To resolve:\n` +
      `1. Create a dedicated branch named 'test' in Neon from your dev branch.\n` +
      `2. Copy connection strings into .env.test as TEST_DATABASE_URL and TEST_DIRECT_URL.\n` +
      `3. Set TEST_DB_MARKER=test.\n` +
      `4. Apply migrations: npx prisma migrate deploy\n` +
      `================================================================================\n`
    );
  }

  const testEnvContent = fs.readFileSync(envTestPath, "utf-8");
  const testEnvConfig = dotenv.parse(testEnvContent);

  const testDatabaseUrl = testEnvConfig.TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;
  const testDirectUrl = testEnvConfig.TEST_DIRECT_URL || process.env.TEST_DIRECT_URL;
  const marker = (testEnvConfig.TEST_DB_MARKER || process.env.TEST_DB_MARKER || "test").toLowerCase();

  if (!testDatabaseUrl || !testDatabaseUrl.trim()) {
    throw new Error(
      `[DATABASE SAFETY GUARD FATAL ERROR] TEST_DATABASE_URL is missing or empty in .env.test! Aborting test run.`
    );
  }

  // Verify TEST_DATABASE_URL is not the same as dev/prod DATABASE_URL from .env
  const devEnvPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(devEnvPath)) {
    const devEnvConfig = dotenv.parse(fs.readFileSync(devEnvPath, "utf-8"));
    if (devEnvConfig.DATABASE_URL && testDatabaseUrl.trim() === devEnvConfig.DATABASE_URL.trim()) {
      throw new Error(
        `[DATABASE SAFETY GUARD FATAL ERROR] TEST_DATABASE_URL in .env.test is identical to DATABASE_URL in .env!\n` +
        `Tests will NOT run against your primary development database.`
      );
    }
  }

  // Verify URL host or pathname contains the configured marker (e.g. 'test')
  try {
    const parsedUrl = new URL(testDatabaseUrl);
    const hostMatches = parsedUrl.hostname.toLowerCase().includes(marker);
    const dbNameMatches = parsedUrl.pathname.toLowerCase().includes(marker);

    if (!hostMatches && !dbNameMatches) {
      throw new Error(
        `[DATABASE SAFETY GUARD FATAL ERROR] TEST_DATABASE_URL does not contain the required marker "${marker}" ` +
        `in its hostname or database name! Connection string rejected to prevent accidental target collision.`
      );
    }
  } catch (e: any) {
    if (e.message.includes("[DATABASE SAFETY GUARD")) {
      throw e;
    }
    throw new Error(`[DATABASE SAFETY GUARD FATAL ERROR] Invalid TEST_DATABASE_URL format: ${e.message}`);
  }

  // Replace active DATABASE_URL and DIRECT_URL in environment
  process.env.DATABASE_URL = testDatabaseUrl;
  if (testDirectUrl) {
    process.env.DIRECT_URL = testDirectUrl;
  }
}

// Execute guard automatically on setupFiles load
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { expect } = require("vitest");
  const testPath = expect?.getState?.()?.testPath;
  enforceDatabaseSafetyGuard(testPath);
} catch {
  // If expect is not yet initialized, enforce on process.argv inspection
  const isDbInArgv = process.argv.some(
    (arg) => arg.includes("adminAuth") || arg.includes("adminActions") || arg.includes("adminCron")
  );
  if (isDbInArgv || process.env.VITEST_DB_TESTS === "true") {
    enforceDatabaseSafetyGuard("db-test-argv");
  }
}
