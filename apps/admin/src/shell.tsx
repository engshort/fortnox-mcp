import type { ReactNode } from "react";
import type { Translate } from "./forms.js";
import { Icon } from "./icons.js";
import { Link } from "./navigation.js";

export function AppShell({
  path,
  t,
  language,
  onLanguage,
  onSignOut,
  children,
}: {
  path: string;
  t: Translate;
  language: string;
  onLanguage: () => void;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const items = [
    ["companies", "companies", t("Företag", "Companies")],
    ["ai-clients", "clients", t("AI-klienter", "AI clients")],
    ["settings", "settings", t("Inställningar", "Settings")],
    ["operations", "operations", t("Drift", "Operations")],
  ];
  return (
    <div className="app-shell">
      <a className="skip-link" href="#content">
        {t("Till innehållet", "Skip to content")}
      </a>
      <aside className="sidebar">
        <Link className="brand" href="/admin/companies">
          <svg
            viewBox="0 0 36 40"
            width="34"
            height="40"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M7 4h28l-3 9H5Zm-3 13h25l-3 9H12l-4 12H0Z" />
          </svg>
          <span>
            <strong>Fortnox MCP</strong>
            <small>{t("Administration", "Administration")}</small>
          </span>
        </Link>
        <nav
          className="primary-nav"
          aria-label={t("Huvudnavigation", "Main navigation")}
        >
          {items.map(([route, icon, label]) => (
            <Link
              key={route}
              href={`/admin/${route}`}
              aria-current={
                path.startsWith(`/admin/${route}`) ? "page" : undefined
              }
            >
              <Icon name={icon ?? "companies"} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Link
            className="help-link"
            href="/admin/help"
            aria-current={path === "/admin/help" ? "page" : undefined}
          >
            <Icon name="help" />
            {t("Hjälp", "Help")}
          </Link>
          <div className="utilities">
            <button type="button" className="text-button" onClick={onLanguage}>
              {language === "sv" ? "English" : "Svenska"}
            </button>
            <button type="button" className="text-button" onClick={onSignOut}>
              {t("Logga ut", "Sign out")}
            </button>
          </div>
        </div>
      </aside>
      <main id="content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
