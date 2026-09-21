import { describe, it, expect } from "vitest";
import {
  generateLicenseKey,
  hashLicenseKey,
  extractKeyPrefix,
  isValidKeyFormat,
} from "../src/services/keyService.js";

describe("keyService", () => {
  it("generates a license key with format INV-XXXX-XXXX-XXXX-XXXX-XXXX", () => {
    const key = generateLicenseKey();
    expect(key).toMatch(
      /^INV-[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$/
    );
    expect(isValidKeyFormat(key)).toBe(true);
  });

  it("produces unique keys across multiple generations", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const key = generateLicenseKey();
      expect(keys.has(key)).toBe(false);
      keys.add(key);
    }
  });

  it("extracts 8-character prefix starting with INV-", () => {
    const key = "INV-78K9-M2NP-34QR-56ST-78VW";
    expect(extractKeyPrefix(key)).toBe("INV-78K9");
  });

  it("hashes keys deterministically to 64-character SHA-256 hex", () => {
    const key = "INV-78K9-M2NP-34QR-56ST-78VW";
    const hash1 = hashLicenseKey(key);
    const hash2 = hashLicenseKey(key);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it("rejects invalid key formats", () => {
    expect(isValidKeyFormat("")).toBe(false);
    expect(isValidKeyFormat("INV-1234")).toBe(false);
    expect(isValidKeyFormat("INVALID-KEY-STRING")).toBe(false);
    // Invalid characters (I, L, O, U are not in Crockford Base32)
    expect(isValidKeyFormat("INV-IIII-LLLL-OOOO-UUUU-1234")).toBe(false);
  });
});
