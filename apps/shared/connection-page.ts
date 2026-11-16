export const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");

// Content is trusted markup; escape all dynamic text before passing it here.
export function connectionPage({
  title,
  content,
  script,
  back = "/admin/companies",
}: {
  title: string;
  content: string;
  script?: "/connect/company.js" | "/consent.js";
  back?: "/admin/companies" | "/admin/ai-clients" | "/app";
}) {
  return `<!doctype html>
<html lang="sv">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)} · Fortnox MCP</title><link rel="stylesheet" href="/admin-assets/admin.css"></head>
<body class="consent-page">
  <a class="skip-link" href="#content">Till innehållet</a>
  <header class="consent-header">
    <a class="brand" href="/admin/companies" aria-label="Fortnox MCP, administration">
      <svg viewBox="0 0 36 40" width="34" height="40" fill="currentColor" aria-hidden="true"><path d="M7 4h28l-3 9H5Zm-3 13h25l-3 9H12l-4 12H0Z" /></svg>
      <span><strong>Fortnox MCP</strong><small>Administration</small></span>
    </a>
    <a class="consent-back" href="${back}">Till administrationen</a>
  </header>
  <main class="consent-main" id="content" tabindex="-1">${content}</main>
  ${script ? `<script src="${script}"></script>` : ""}
</body></html>`;
}
