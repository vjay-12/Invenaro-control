import { describe, it, expect } from "vitest";
import {
  getSessionCookieName,
  buildSessionCookieOptions,
  parseCookies,
} from "../src/admin/auth/session.js";

describe("Production Admin Cookie Safety & Attributes", () => {
  it("uses __Secure- prefix and strict flags in production / secure environments", () => {
    const prodCookieName = getSessionCookieName(true);
    expect(prodCookieName).toBe("__Secure-invenaro_admin");

    const prodOptions = buildSessionCookieOptions({
      isProductionOrSecure: true,
      maxAgeMs: 12 * 3600 * 1000,
    });

    expect(prodOptions).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/admin",
      maxAge: 12 * 3600 * 1000,
    });

    // Verify no Domain attribute is set (per RFC 6265bis for secure sub-path cookies)
    expect((prodOptions as any).domain).toBeUndefined();
  });

  it("uses plain invenaro_admin cookie in local development non-secure mode", () => {
    const devCookieName = getSessionCookieName(false);
    expect(devCookieName).toBe("invenaro_admin");

    const devOptions = buildSessionCookieOptions({
      isProductionOrSecure: false,
    });

    expect(devOptions).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: "strict",
      path: "/admin",
    });
  });

  it("correctly parses cookies from incoming header using the same cookie name", () => {
    const cookieName = getSessionCookieName(true);
    const header = `${cookieName}=secret-token-value; other_cookie=xyz`;
    const parsed = parseCookies(header);

    expect(parsed[cookieName]).toBe("secret-token-value");
  });
});
