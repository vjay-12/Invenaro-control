import { describe, it, expect } from "vitest";
import { constantTimeCompare, hashToken } from "../src/admin/auth/crypto.js";
import { buildPasswordResetRequestedEmail, sanitizeSubject } from "../src/services/email.js";

describe("Password Reset Code Hygiene (Pure Unit Tests)", () => {
  describe("constantTimeCompare", () => {
    it("returns true for identical strings", () => {
      expect(constantTimeCompare("my-secure-token-12345", "my-secure-token-12345")).toBe(true);
      expect(constantTimeCompare(hashToken("admin:123456"), hashToken("admin:123456"))).toBe(true);
    });

    it("returns false for different strings with same length", () => {
      expect(constantTimeCompare("123456", "123457")).toBe(false);
      expect(constantTimeCompare("aaaaaa", "bbbbbb")).toBe(false);
    });

    it("returns false for strings of different lengths", () => {
      expect(constantTimeCompare("short", "much-longer-string")).toBe(false);
      expect(constantTimeCompare("", "non-empty")).toBe(false);
    });
  });

  describe("buildPasswordResetRequestedEmail", () => {
    it("never includes the 6-digit code or token in the email subject", () => {
      const otp = "849201";
      const resetUrl = "https://control.example.com/admin/reset/secret-token-xyz";
      const email = buildPasswordResetRequestedEmail({
        resetUrl,
        ip: "192.168.1.100",
        otp,
      });

      // Subject must NEVER leak the OTP or token
      expect(email.subject).not.toContain(otp);
      expect(email.subject).not.toContain("secret-token-xyz");
      expect(email.subject).toBe("Password Reset Verification Code");

      // Body contains the code in a clean box and link
      expect(email.html).toContain(otp);
      expect(email.html).toContain(resetUrl);
      expect(email.text).toContain(otp);
    });
  });

  describe("sanitizeSubject", () => {
    it("strips CRLF injection characters from subjects", () => {
      const subject = "Password Reset\r\nBcc: evil@attacker.com\nAnother line";
      expect(sanitizeSubject(subject)).toBe("Password Reset Bcc: evil@attacker.com Another line");
    });
  });
});
