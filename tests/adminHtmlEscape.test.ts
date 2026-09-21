import { describe, it, expect } from "vitest";
import { html, escapeHtml, raw } from "../src/admin/views/template.js";

describe("HTML Escaping & Templating Tests", () => {
  it("escapes malicious HTML characters in interpolated values by default", () => {
    const maliciousInput = '<script>alert("XSS")</script>';
    const rendered = html`<div>${maliciousInput}</div>`;

    expect(typeof rendered).toBe("string");
    expect(rendered).not.toContain("<script>");
    expect(rendered).toContain("&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;");
  });

  it("escapes ampersands, quotes, and angle brackets", () => {
    const companyName = "Ben & Jerry's \"Ice Cream\" <Premium>";
    const rendered = html`<span>${companyName}</span>`;

    expect(rendered).toContain("Ben &amp; Jerry&#39;s &quot;Ice Cream&quot; &lt;Premium&gt;");
  });

  it("allows trusted markup only through explicit raw() escape hatch", () => {
    const trustedBadge = raw('<span class="badge">Active</span>');
    const rendered = html`<div>${trustedBadge}</div>`;

    expect(rendered).toBe('<div><span class="badge">Active</span></div>');
  });

  it("escapes arrays of values cleanly", () => {
    const list = ["<b>one</b>", "<i>two</i>"];
    const rendered = html`<ul>${list.map((item) => raw(html`<li>${item}</li>`))}</ul>`;

    expect(rendered).not.toContain("<b>");
    expect(rendered).toContain("&lt;b&gt;one&lt;/b&gt;");
    expect(rendered).toContain("&lt;i&gt;two&lt;/i&gt;");
  });
});
