import { describe, it, expect } from "vitest";
import { html, raw, RawString, escapeHtml } from "../src/admin/views/template.js";

describe("html template tag & escaping", () => {
  it("escapes a plain string containing <script>alert(1)</script> and quotes in text and attribute positions", () => {
    const malicious = `<script>alert("xss")</script> & 'single'`;
    const result = html`<div title="${malicious}">${malicious}</div>`;
    
    expect(result).toBeInstanceOf(RawString);
    expect(result.value).not.toContain("<script>");
    expect(result.value).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &#39;single&#39;");
    expect(result.value).toContain(`title="&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &#39;single&#39;"`);
  });

  it("does NOT double-escape nested html fragments", () => {
    const inner = html`<span class="badge">Nested &amp; <b>Bold</b></span>`;
    const outer = html`<div>${inner}</div>`;

    expect(outer.value).toBe(`<div><span class="badge">Nested &amp; <b>Bold</b></span></div>`);
    expect(outer.value).not.toContain("&lt;span");
  });

  it("renders arrays of html fragments correctly without double escaping", () => {
    const items = ["One", "Two", "Three"].map(
      (item) => html`<li><strong>${item}</strong></li>`
    );
    const result = html`<ul>${items}</ul>`;

    expect(result.value).toBe("<ul><li><strong>One</strong></li><li><strong>Two</strong></li><li><strong>Three</strong></li></ul>");
    expect(result.value).not.toContain("&lt;li");
  });

  it("escapes plain strings in arrays", () => {
    const items = ["<b>Alert</b>", "Normal"];
    const result = html`<div>${items}</div>`;

    expect(result.value).toBe("<div>&lt;b&gt;Alert&lt;/b&gt;Normal</div>");
  });

  it("renders false, null, and undefined as empty strings", () => {
    const result = html`<div>${false}${null}${undefined}</div>`;
    expect(result.value).toBe("<div></div>");
  });

  it("renders numbers properly", () => {
    const count = 42;
    const zero = 0;
    const result = html`<div>${count} items, ${zero} left</div>`;
    expect(result.value).toBe("<div>42 items, 0 left</div>");
  });

  it("allows trusted strings via raw()", () => {
    const trusted = raw("<span>Trusted Markup</span>");
    const result = html`<div>${trusted}</div>`;
    expect(result.value).toBe("<div><span>Trusted Markup</span></div>");
  });

  it("escapes values processed directly by escapeHtml", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(new RawString("<b>raw</b>"))).toBe("<b>raw</b>");
  });
});
