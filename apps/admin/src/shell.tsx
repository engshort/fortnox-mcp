import type { ReactNode } from "react";
import type { Translate } from "./forms.js";
import { Icon } from "./icons.js";
import { Link } from "./navigation.js";

export function Brand({
  t,
  navigation = false,
}: {
  t: Translate;
  navigation?: boolean;
}) {
  const Component = navigation ? Link : "a";
  return (
    <Component
      className="brand"
      href="/admin/companies"
      aria-label={t(
        "Fortnox MCP, administration",
        "Fortnox MCP, administration",
      )}
    >
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
    </Component>
  );
}

export function AppShell({
  path,
  multiUser = false,
  t,
  language,
  onLanguage,
  onSignOut,
  children,
}: {
  path: string;
  multiUser?: boolean;
  t: Translate;
  language: string;
  onLanguage: () => void;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const items = [
    ["companies", "companies", t("Företag", "Companies")],
    ["ai-clients", "clients", t("AI-klienter", "AI clients")],
    ...(multiUser
      ? [
          ["members", "clients", t("Medlemmar", "Members")],
          [
            "membership-sources",
            "settings",
            t("Integrationer", "Integrations"),
          ],
        ]
      : []),
    ["settings", "settings", t("Inställningar", "Settings")],
    ["operations", "operations", t("Drift", "Operations")],
  ];
  return (
    <div className="app-shell">
      <a className="skip-link" href="#content">
        {t("Till innehållet", "Skip to content")}
      </a>
      <aside className="sidebar">
        <Brand t={t} navigation />
        <nav
          className="primary-nav"
          aria-label={t("Huvudnavigation", "Main navigation")}
        >
          {items.map(([route, icon, label]) => (
            <Link
              key={route}
              href={`/admin/${route}`}
              aria-label={
                route === "membership-sources"
                  ? t("Medlemsintegrationer", "Membership integrations")
                  : undefined
              }
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
