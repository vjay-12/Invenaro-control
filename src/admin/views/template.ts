export class RawString {
  constructor(public value: string) {}
  toString(): string {
    return this.value;
  }
}

export function raw(val: string | RawString): RawString {
  return new RawString(val instanceof RawString ? val.value : String(val));
}

export function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return "";
  if (str instanceof RawString) return str.value;
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  let result = strings[0];
  for (let i = 0; i < values.length; i++) {
    const val = values[i];
    if (Array.isArray(val)) {
      result += val.map((item) => (item instanceof RawString ? item.value : escapeHtml(item))).join("");
    } else if (val instanceof RawString) {
      result += val.value;
    } else {
      result += escapeHtml(val);
    }
    result += strings[i + 1];
  }
  return result;
}

export interface LayoutOptions {
  title: string;
  content: string | RawString;
  nonce?: string;
  userEmail?: string;
  currentPath?: string;
  csrfToken?: string;
  alert?: { type: "success" | "error" | "warning"; message: string };
}

export function renderLayout(opts: LayoutOptions): string {
  const nonceAttr = opts.nonce ? ` nonce="${opts.nonce}"` : "";
  const isLoggedIn = Boolean(opts.userEmail);
  const contentStr = opts.content instanceof RawString ? opts.content.value : opts.content;

  return html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${opts.title} - Invenaro Control</title>
  <style${raw(nonceAttr)}>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background-color: #0f172a;
      color: #f1f5f9;
      line-height: 1.5;
    }
    a { color: #38bdf8; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .nav-bar {
      background-color: #1e293b;
      border-bottom: 1px solid #334155;
      padding: 12px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }
    .nav-brand { font-weight: 700; font-size: 18px; color: #ffffff; letter-spacing: -0.02em; }
    .nav-links { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; font-size: 14px; }
    .nav-links a { color: #94a3b8; padding: 6px 10px; border-radius: 6px; }
    .nav-links a.active, .nav-links a:hover { color: #ffffff; background-color: #334155; text-decoration: none; }
    .nav-user { display: flex; align-items: center; gap: 12px; font-size: 13px; color: #94a3b8; }
    .container { max-width: 1100px; margin: 0 auto; padding: 24px 16px; }
    .auth-card {
      max-width: 420px;
      margin: 60px auto;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 32px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
    }
    .auth-title { margin-top: 0; margin-bottom: 8px; font-size: 22px; font-weight: 700; color: #ffffff; }
    .auth-subtitle { color: #94a3b8; font-size: 14px; margin-bottom: 24px; }
    .form-group { margin-bottom: 18px; }
    label { display: block; font-size: 13px; font-weight: 600; color: #cbd5e1; margin-bottom: 6px; }
    input[type="text"], input[type="email"], input[type="password"], input[type="date"], select, textarea {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #475569;
      border-radius: 6px;
      background-color: #0f172a;
      color: #ffffff;
      font-size: 14px;
    }
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: #38bdf8;
      box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.2);
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 9px 16px;
      font-size: 14px;
      font-weight: 600;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      background-color: #0284c7;
      color: #ffffff;
      text-decoration: none;
      transition: background-color 0.15s;
    }
    .btn:hover { background-color: #0369a1; text-decoration: none; }
    .btn-secondary { background-color: #334155; color: #cbd5e1; }
    .btn-secondary:hover { background-color: #475569; color: #ffffff; }
    .btn-danger { background-color: #dc2626; color: #ffffff; }
    .btn-danger:hover { background-color: #b91c1c; }
    .btn-block { width: 100%; }
    .alert {
      padding: 12px 16px;
      border-radius: 6px;
      margin-bottom: 20px;
      font-size: 14px;
    }
    .alert-error { background-color: rgba(220, 38, 38, 0.15); border: 1px solid #dc2626; color: #fca5a5; }
    .alert-success { background-color: rgba(22, 163, 74, 0.15); border: 1px solid #16a34a; color: #86efac; }
    .alert-warning { background-color: rgba(234, 179, 8, 0.15); border: 1px solid #eab308; color: #fde047; }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid #334155;
    }
    .card-title { font-size: 16px; font-weight: 700; color: #ffffff; margin: 0; }
    .grid-metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .metric-card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 16px;
    }
    .metric-val { font-size: 28px; font-weight: 800; color: #ffffff; margin-top: 4px; }
    .metric-label { font-size: 13px; color: #94a3b8; font-weight: 500; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th { text-align: left; padding: 10px 12px; background-color: #0f172a; color: #cbd5e1; border-bottom: 1px solid #334155; }
    td { padding: 10px 12px; border-bottom: 1px solid #334155; color: #e2e8f0; }
    tr:hover td { background-color: #273549; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-active { background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.4); }
    .badge-grace { background: rgba(234, 179, 8, 0.2); color: #facc15; border: 1px solid rgba(234, 179, 8, 0.4); }
    .badge-expired { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); }
    .badge-suspended { background: rgba(148, 163, 184, 0.2); color: #cbd5e1; border: 1px solid rgba(148, 163, 184, 0.4); }
    .badge-basic { background: #334155; color: #e2e8f0; }
    .badge-business { background: #1e3a8a; color: #93c5fd; }
    .badge-enterprise { background: #581c87; color: #d8b4fe; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13px; }
    .key-box {
      background: #090d16;
      border: 1px solid #38bdf8;
      border-radius: 8px;
      padding: 16px;
      margin: 16px 0;
      font-family: ui-monospace, monospace;
      font-size: 16px;
      color: #38bdf8;
      word-break: break-all;
    }
    .flex-row { display: flex; gap: 12px; align-items: center; }
    .pagination { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; font-size: 14px; }
    .form-actions-row {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      margin-top: 10px;
      margin-bottom: 28px;
      width: 100%;
    }
    .forgot-link {
      font-size: 13px;
      color: #38bdf8;
      text-decoration: none;
      font-weight: 500;
      margin-left: auto;
      display: inline-block;
    }
    .forgot-link:hover {
      text-decoration: underline;
      color: #7dd3fc;
    }
    .auth-submit-btn {
      width: 100%;
      padding: 12px 16px;
      font-size: 15px;
      font-weight: 600;
    }
  </style>
</head>
<body>
  ${isLoggedIn ? raw(html`
    <nav class="nav-bar">
      <div class="flex-row">
        <span class="nav-brand">Invenaro Control</span>
        <div class="nav-links">
          <a href="/admin" class="${opts.currentPath === "/admin" ? "active" : ""}">Dashboard</a>
          <a href="/admin/customers" class="${opts.currentPath?.startsWith("/admin/customers") ? "active" : ""}">Customers</a>
          <a href="/admin/audit" class="${opts.currentPath?.startsWith("/admin/audit") ? "active" : ""}">Audit Logs</a>
          <a href="/admin/notifications" class="${opts.currentPath?.startsWith("/admin/notifications") ? "active" : ""}">Notifications</a>
          <a href="/admin/account" class="${opts.currentPath?.startsWith("/admin/account") ? "active" : ""}">Account</a>
        </div>
      </div>
      <div class="nav-user">
        <span>${opts.userEmail}</span>
        <form method="POST" action="/admin/logout" style="margin: 0;">
          <input type="hidden" name="_csrf" value="${opts.csrfToken || ""}">
          <button type="submit" class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px;">Sign Out</button>
        </form>
      </div>
    </nav>
  `) : ""}

  <div class="container">
    ${opts.alert ? raw(html`
      <div class="alert alert-${opts.alert.type}">
        ${opts.alert.message}
      </div>
    `) : ""}
    ${raw(contentStr)}
  </div>

  <script${raw(nonceAttr)}>
    document.querySelectorAll('[data-copy]').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-copy');
        const el = document.getElementById(targetId);
        if (el) {
          const text = el.innerText || el.value;
          navigator.clipboard.writeText(text).then(() => {
            const originalText = btn.innerText;
            btn.innerText = 'Copied!';
            setTimeout(() => { btn.innerText = originalText; }, 2000);
          });
        }
      });
    });
  </script>
</body>
</html>`;
}
