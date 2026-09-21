import { describe, it, expect } from "vitest";
import * as OTPAuth from "otpauth";
import {
  generateTotpSecret,
  verifyTotpCodeWithReplay,
  verifyTotpCode,
} from "../src/admin/auth/totp.js";

describe("TOTP Replay Protection & Limits (Pure Unit Tests)", () => {
  it("verifies valid TOTP code and returns validated time step", () => {
    const secret = generateTotpSecret();
    const totp = new OTPAuth.TOTP({
      issuer: "Invenaro Control",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });

    const code = totp.generate();
    const result = verifyTotpCodeWithReplay(secret, code, null);

    expect(result.valid).toBe(true);
    expect(result.timeStep).toBeDefined();
    expect(typeof result.timeStep).toBe("number");
  });

  it("rejects code reuse when lastTimeStep is >= the code's time step (replay protection)", () => {
    const secret = generateTotpSecret();
    const totp = new OTPAuth.TOTP({
      issuer: "Invenaro Control",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });

    const code = totp.generate();
    const firstCheck = verifyTotpCodeWithReplay(secret, code, null);
    expect(firstCheck.valid).toBe(true);
    const acceptedStep = firstCheck.timeStep!;

    // Immediate reuse of the same code with lastTimeStep set to acceptedStep MUST be rejected
    const replayCheck = verifyTotpCodeWithReplay(secret, code, acceptedStep);
    expect(replayCheck.valid).toBe(false);

    // verifyTotpCode boolean wrapper also returns false
    expect(verifyTotpCode(secret, code, acceptedStep)).toBe(false);
  });

  it("accepts codes from future time steps", () => {
    const secret = generateTotpSecret();
    const totp = new OTPAuth.TOTP({
      issuer: "Invenaro Control",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });

    const code = totp.generate();
    const currentStep = Math.floor(Date.now() / 1000 / 30);

    // If last accepted step was an older step in the past
    const pastStep = currentStep - 5;
    const result = verifyTotpCodeWithReplay(secret, code, pastStep);

    expect(result.valid).toBe(true);
  });

  it("rejects invalid TOTP codes", () => {
    const secret = generateTotpSecret();
    const result = verifyTotpCodeWithReplay(secret, "000000", null);
    expect(result.valid).toBe(false);
  });
});
