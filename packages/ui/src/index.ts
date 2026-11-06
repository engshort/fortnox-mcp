export { installationPage } from "./installation.js";
export * from "./voucher-review.js";

export function foundationPage(language: "sv" | "en" = "sv"): string {
  const title =
    language === "sv"
      ? "Fortnox MCP – utvecklingsmiljö"
      : "Fortnox MCP – development environment";
  const message =
    language === "sv"
      ? "Utvecklingsversion med syntetiska data. Fortnox är ännu inte anslutet."
      : "Development version with synthetic data. Fortnox is not connected yet.";
  return `<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><main><h1>${title}</h1><p>${message}</p></main></html>`;
}
