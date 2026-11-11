import type { FeatureId, ProgramId, ProgramPreview } from "@fortnox-mcp/core";
import { type FormEvent, useEffect, useState } from "react";
import { api, type Company, type InstallationState } from "./api.js";
import { useModalDialog } from "./dialog.js";
import { Companies, Diagnosis, Message, type Translate } from "./forms.js";
import { Icon } from "./icons.js";
import { Link, navigate } from "./navigation.js";

export const companyPath = (c: Company) => `/admin/companies/${c.company_id}`;
export function Status({
  positive = false,
  children,
}: {
  positive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className={`connection-status${positive ? " positive" : ""}`}>
      <span className="status-dot" />
      {children}
    </span>
  );
}
export function connectionText(state: string, t: Translate) {
  return state === "active" || state === "connected"
    ? t("Anslutet", "Connected")
    : state === "reconnect_required"
      ? t("Återanslutning krävs", "Reconnection required")
      : t("Inte anslutet", "Not connected");
}
export function CompanyListPage({
  state,
  t,
  add,
}: {
  state: InstallationState;
  t: Translate;
  add: () => void;
}) {
  const [search, setSearch] = useState("");
  const companies = state.companies.filter((c) =>
    `${c.name} ${c.organization_number}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t("Dina företag", "Your companies")}</h1>
          <p className="intro">
            {t(
              "Välj företag och anslut de delar av Fortnox som behövs.",
              "Choose a company and connect the parts of Fortnox you need.",
            )}
          </p>
        </div>
        <button type="button" onClick={add}>
          <Icon name="plus" />
          {t("Lägg till företag", "Add company")}
        </button>
      </div>
      <label className="search-field">
        {t("Sök företag", "Search companies")}
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t(
            "Företagsnamn eller organisationsnummer",
            "Company name or registration number",
          )}
        />
      </label>
      {companies.length ? (
        <div className="company-list">
          {companies.map((c) => (
            <Link
              href={companyPath(c)}
              className="company-list-row"
              key={c.company_id}
            >
              <span className="program-icon">
                <Icon name="companies" />
              </span>
              <span className="company-list-name">
                <strong>{c.name}</strong>
                <small>
                  {c.organization_number ||
                    t(
                      "Organisationsnummer saknas",
                      "Registration number unavailable",
                    )}
                </small>
              </span>
              <Status positive={c.state === "active"}>
                {connectionText(c.state, t)}
              </Status>
              <Icon name="arrow" />
            </Link>
          ))}
        </div>
      ) : (
        <section className="empty-state">
          <Icon name="companies" size={40} />
          <h2>
            {state.companies.length
              ? t("Inga företag matchar sökningen", "No matching companies")
              : t(
                  "Ditt första företag börjar här",
                  "Start with your first company",
                )}
          </h2>
          <p>
            {state.companies.length
              ? t(
                  "Prova ett annat namn eller organisationsnummer.",
                  "Try another name or registration number.",
                )
              : t(
                  "Anslut företagsuppgifter först. Lägg till program när företaget behöver dem.",
                  "Connect company information first. Add programs when the company needs them.",
                )}
          </p>
          {!state.companies.length && (
            <button type="button" onClick={add}>
              {t("Lägg till företag", "Add company")}
            </button>
          )}
        </section>
      )}
      <div className="connection-note">
        <Icon name="link" />
        <p>
          <strong>
            {t(
              "Ett företag. Flera program.",
              "One company. Multiple programs.",
            )}
          </strong>{" "}
          {t(
            "Varje företag har egna programval och egen åtkomst.",
            "Each company has its own programs and access.",
          )}
        </p>
      </div>
    </>
  );
}
export function CompanyLayout({
  company,
  state,
  page,
  t,
  add,
  connect,
  perform,
}: {
  company: Company;
  state: InstallationState;
  page: string;
  t: Translate;
  add: () => void;
  connect: (p: ProgramId) => void;
  perform: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const tabs = [
    ["", t("Översikt", "Overview")],
    ...company.programs.programs.map((p) => [p.id, t(p.sv, p.en)]),
    ["access", t("Åtkomst", "Access")],
  ];
  const currentProgram = company.programs.programs.find((p) => p.id === page);
  return (
    <>
      <div className="breadcrumb-row">
        <div className="breadcrumb">
          <Link href="/admin/companies">{t("Företag", "Companies")}</Link>
          <span>/</span>
          <span>{company.name}</span>
        </div>
        <button className="secondary" type="button" onClick={add}>
          <Icon name="plus" />
          {t("Lägg till företag", "Add company")}
        </button>
      </div>
      <div className="company-heading">
        <h1>{company.name}</h1>
        <label className="company-switcher">
          <span className="sr-only">{t("Byt företag", "Switch company")}</span>
          <select
            value={company.company_id}
            onChange={(e) =>
              navigate(
                `/admin/companies/${e.target.value}${page ? `/${page}` : ""}`,
              )
            }
          >
            {state.companies.map((c) => (
              <option key={c.company_id} value={c.company_id}>
                {c.name}
              </option>
            ))}
          </select>
          <span aria-hidden="true">⌄</span>
        </label>
      </div>
      <Status positive={company.state === "active"}>
        {company.state === "active"
          ? t("Företagsuppgifter anslutna", "Company information connected")
          : connectionText(company.state, t)}
      </Status>
      <nav
        className="company-tabs"
        aria-label={t("Företagsvyer", "Company views")}
      >
        {tabs.map(([id, label]) => (
          <Link
            key={id}
            href={`${companyPath(company)}${id ? `/${id}` : ""}`}
            aria-current={page === id ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      {company.programs.pending && (
        <p className="notice">
          {t(
            "Godkännande pågår hos Fortnox. Befintlig åtkomst gäller tills ersättningen är verifierad.",
            "Fortnox consent is pending. Existing access remains until the replacement is verified.",
          )}
        </p>
      )}
      {!page ? (
        <>
          <h2>{t("Dina program", "Your programs")}</h2>
          <p className="intro">
            {t(
              "Anslut de delar av Fortnox som företaget behöver.",
              "Connect the parts of Fortnox this company needs.",
            )}
          </p>
          <div className="program-table">
            <div className="program-table-header">
              <span>{t("Program", "Program")}</span>
              <span>{t("Anslutning", "Connection")}</span>
              <span>{t("Tillgängligt", "Available")}</span>
              <span>{t("Åtgärd", "Action")}</span>
            </div>
            {company.programs.programs.map((p) => (
              <div className="program-row" key={p.id}>
                <Link
                  className="program-name"
                  href={`${companyPath(company)}/${p.id}`}
                >
                  <span className="program-icon">
                    <Icon name={p.id} size={28} />
                  </span>
                  <strong>{t(p.sv, p.en)}</strong>
                </Link>
                <Status positive={p.connection === "connected"}>
                  {connectionText(p.connection, t)}
                </Status>
                <span className="availability">
                  {p.availability === "available"
                    ? t("Tillgängligt", "Available")
                    : p.availability === "planned"
                      ? t("Stöd planeras", "Support planned")
                      : t("Verifiering återstår", "Verification pending")}
                </span>
                <div className="row-action">
                  {p.can_connect && p.connection !== "connected" ? (
                    <button type="button" onClick={() => connect(p.id)}>
                      {t("Anslut", "Connect")}
                    </button>
                  ) : (
                    <Link href={`${companyPath(company)}/${p.id}`}>
                      {p.connection === "connected"
                        ? t("Hantera", "Manage")
                        : t("Läs mer", "Learn more")}
                      <Icon name="arrow" size={20} />
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="connection-note">
            <Icon name="link" />
            <p>
              <strong>
                {t(
                  "Ett företag. Flera program.",
                  "One company. Multiple programs.",
                )}
              </strong>{" "}
              {t(
                "Utöka åtkomsten när du behöver. Godkänn varje tillägg hos Fortnox.",
                "Extend access when you need it. Approve each addition in Fortnox.",
              )}
            </p>
          </div>
          <section className="base-connection">
            <div>
              <h3>{t("Företagsuppgifter", "Company information")}</h3>
              <p className="muted">{company.organization_number}</p>
            </div>
            <Status positive={company.state === "active"}>
              {connectionText(company.state, t)}
            </Status>
            <Diagnosis company={company.company_id} t={t} />
          </section>
        </>
      ) : page === "access" ? (
        <Companies
          state={{ ...state, companies: [company], investigations: [] }}
          t={t}
          perform={perform}
        />
      ) : currentProgram ? (
        <section>
          <div className="page-heading">
            <div>
              <h2>{t(currentProgram.sv, currentProgram.en)}</h2>
              <Status positive={currentProgram.connection === "connected"}>
                {connectionText(currentProgram.connection, t)}
              </Status>
            </div>
            {currentProgram.can_connect && (
              <button type="button" onClick={() => connect(currentProgram.id)}>
                {t("Anslut program", "Connect program")}
              </button>
            )}
          </div>
          <div className="feature-list">
            {currentProgram.capabilities.map((capability) => (
              <div key={capability.en}>
                <strong>{t(capability.sv, capability.en)}</strong>
                <span className="muted">
                  {capability.implementation === "not_implemented"
                    ? t("Stöd planeras", "Support planned")
                    : t("Verifiering återstår", "Verification pending")}
                </span>
              </div>
            ))}
          </div>
          <p>
            {currentProgram.availability === "planned"
              ? t(
                  "Programmet kan anslutas när implementerat och verifierbart stöd finns. Ingen åtkomst begärs ännu.",
                  "Connect this program when implemented, verifiable support is available. No access is requested yet.",
                )
              : t(
                  "Funktionerna använder företagets Fortnox-behörigheter, skrivskydd och verifikationspolicy. Verifiering i verkliga klienter och Fortnox pågår.",
                  "Features use the company's Fortnox permissions, read-only setting and voucher policy. Actual client and Fortnox verification is ongoing.",
                )}
          </p>
          {currentProgram.selected && (
            <button
              type="button"
              className="secondary"
              onClick={() =>
                void perform(() =>
                  api(
                    `/admin/companies/${company.company_id}/programs/disable`,
                    {
                      program: currentProgram.id,
                      expected_revision: company.programs.revision,
                    },
                  ),
                )
              }
            >
              {t("Inaktivera program lokalt", "Disable program locally")}
            </button>
          )}
        </section>
      ) : (
        <p>{t("Sidan finns inte.", "Page not found.")}</p>
      )}
    </>
  );
}

export function ProgramConnectionDialog({
  company,
  program,
  t,
  close,
}: {
  company: Company;
  program: ProgramId;
  t: Translate;
  close: () => void;
}) {
  const ref = useModalDialog();
  const [preview, setPreview] = useState<ProgramPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [latestPrograms, setLatestPrograms] = useState<
    Company["programs"] | null
  >(null);
  const [files, setFiles] = useState(
    company.programs.features.includes("receipt-files"),
  );
  const available =
    latestPrograms?.programs.find((p) => p.id === program)?.connect_features ??
    [];
  const features: FeatureId[] = [
    ...available.filter((id) => id !== "receipt-files"),
    ...(available.includes("receipt-files") && files
      ? ["receipt-files" as const]
      : []),
  ];
  const featureKey = features.join(",");
  const selection = {
    program,
    features,
    expected_revision: latestPrograms?.revision ?? company.programs.revision,
  };
  useEffect(() => {
    let active = true;
    setLatestPrograms(null);
    void api<Company["programs"]>(
      `/admin/companies/${company.company_id}/programs`,
    )
      .then((current) => {
        if (active) setLatestPrograms(current);
      })
      .catch(() => {
        if (active)
          setError(
            t(
              "Anslutningen kunde inte läsas. Ladda om sidan och försök igen.",
              "Could not read the connection. Reload the page and try again.",
            ),
          );
      });
    return () => {
      active = false;
    };
  }, [company.company_id, t]);
  useEffect(() => {
    if (!latestPrograms) return;
    let active = true;
    setPreview(null);
    setError("");
    void api<ProgramPreview>(
      `/admin/companies/${company.company_id}/programs/preview`,
      {
        program,
        features: featureKey.split(","),
        expected_revision: latestPrograms.revision,
      },
    )
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch((failure: unknown) => {
        if (active)
          setError(
            failure instanceof Error &&
              failure.message.includes("OUTCOME_UNKNOWN")
              ? t(
                  "En tidigare skrivning har okänt resultat. Utred resultatet innan du ändrar den berörda åtkomsten.",
                  "A previous write has an unknown outcome. Reconcile it before changing the affected access.",
                )
              : t(
                  "Åtkomsten kunde inte förberedas. Kontrollera anslutningen och försök igen.",
                  "Could not prepare access. Check the connection and try again.",
                ),
          );
      });
    return () => {
      active = false;
    };
  }, [company.company_id, latestPrograms, program, featureKey, t]);
  const label = (latestPrograms ?? company.programs).programs.find(
    (p) => p.id === program,
  );
  return (
    <dialog
      ref={ref}
      className="connection-dialog"
      aria-labelledby="program-dialog-title"
      onClose={close}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
    >
      <button
        type="button"
        className="dialog-close"
        disabled={busy}
        aria-label={t("Stäng", "Close")}
        onClick={() => ref.current?.close()}
      >
        <Icon name="close" />
      </button>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || !preview) return;
          setBusy(true);
          setError("");
          try {
            const result = await api(
              `/admin/companies/${company.company_id}/programs/start`,
              selection,
            );
            redirectToFortnox(result.url);
          } catch {
            setBusy(false);
            setError(
              t(
                "Anslutningen kunde inte startas. Befintlig åtkomst är oförändrad.",
                "Could not start the connection. Existing local access is unchanged.",
              ),
            );
          }
        }}
      >
        <div className="dialog-body">
          <h2 id="program-dialog-title">
            {t("Anslut", "Connect")} {label ? t(label.sv, label.en) : program}
          </h2>
          <p className="dialog-company">{company.name}</p>
          <p>
            {t(
              "Du godkänner utökad åtkomst hos Fortnox.",
              "You approve extended access in Fortnox.",
            )}
          </p>
          <dl className="consent-summary">
            <div>
              <dt>{t("Redan anslutet", "Already connected")}</dt>
              <dd>
                {t("Företagsuppgifter", "Company information")}
                {(latestPrograms ?? company.programs).programs
                  .filter((p) => p.selected)
                  .map((p) => `, ${t(p.sv, p.en)}`)
                  .join("")}
              </dd>
            </div>
            <div>
              <dt>{t("Läggs till", "Adding")}</dt>
              <dd>{label ? t(label.sv, label.en) : program}</dd>
            </div>
          </dl>
          <h3>{t("Åtkomst som behövs", "Access needed")}</h3>
          <ul className="access-list">
            {label?.connection_features
              .filter(
                (f) => features.includes(f.id) && f.id !== "receipt-files",
              )
              .map((f) => (
                <li key={f.id}>{t(f.sv, f.en)}</li>
              ))}
          </ul>
          {available.includes("receipt-files") && (
            <label className="optional-feature">
              <input
                type="checkbox"
                checked={files}
                onChange={(e) => setFiles(e.target.checked)}
                disabled={
                  busy ||
                  (latestPrograms ?? company.programs).features.includes(
                    "receipt-files",
                  )
                }
              />
              <span>
                <strong>
                  {t(
                    "Kvitton och filkopplingar",
                    "Receipts and file connections",
                  )}
                </strong>
                <small>
                  {t(
                    "Begär åtkomst för att ladda upp och koppla kvittofiler i Fortnox.",
                    "Request access to upload and link receipt files in Fortnox.",
                  )}
                </small>
              </span>
            </label>
          )}
          <details>
            <summary>{t("Visa behörigheter", "Show scopes")}</summary>
            <p>
              {t("Befintliga:", "Existing:")}{" "}
              {preview?.existing_scopes.join(", ")}
            </p>
            <p>
              {t("Tillägg:", "Additional:")}{" "}
              {preview?.added_scopes.join(", ") || "—"}
            </p>
          </details>
          <p className="muted">
            {t(
              "Efter godkännandet kontrollerar vi företag och beviljad åtkomst. Funktionsstöd och licens redovisas separat. AI-klienten behöver ett nytt godkännande.",
              "After consent we check the company and granted access. Capability support and licensing are reported separately. The AI client needs fresh consent.",
            )}
          </p>
          <Message>
            {error ||
              (!preview ? t("Förbereder åtkomst…", "Preparing access…") : "")}
          </Message>
        </div>
        <div className="dialog-actions">
          <button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={() => ref.current?.close()}
          >
            {t("Avbryt", "Cancel")}
          </button>
          <button type="submit" disabled={busy || !preview}>
            {busy
              ? t("Vänta…", "Please wait…")
              : t("Fortsätt till Fortnox", "Continue to Fortnox")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
export function redirectToFortnox(url?: string) {
  if (!url || new URL(url).origin !== "https://apps.fortnox.se")
    throw new Error("REQUEST_FAILED");
  location.assign(url);
}
export function AddCompanyDialog({
  state,
  t,
  close,
}: {
  state: InstallationState;
  t: Translate;
  close: () => void;
}) {
  const ref = useModalDialog();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      redirectToFortnox(
        (
          await api("/admin/fortnox/start", {
            mode: new FormData(event.currentTarget).get("mode"),
          })
        ).url,
      );
    } catch {
      setBusy(false);
      setError(
        t(
          "Anslutningen kunde inte startas.",
          "Could not start the connection.",
        ),
      );
    }
  }
  return (
    <dialog
      className="connection-dialog"
      ref={ref}
      aria-labelledby="add-dialog-title"
      onClose={close}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
    >
      <button
        type="button"
        className="dialog-close"
        disabled={busy}
        aria-label={t("Stäng", "Close")}
        onClick={() => ref.current?.close()}
      >
        <Icon name="close" />
      </button>
      <form onSubmit={submit}>
        <div className="dialog-body">
          <h2 id="add-dialog-title">{t("Lägg till företag", "Add company")}</h2>
          <p>
            {t(
              "Börja med företagets grunduppgifter. Välj och anslut program efteråt.",
              "Start with company information. Choose and connect programs afterwards.",
            )}
          </p>
          <p>
            {t(
              "Begärd åtkomst: företagsuppgifter och profil.",
              "Requested access: company information and profile.",
            )}
          </p>
          <label className="field">
            {t("Anslutningstyp", "Connection type")}
            <select name="mode" disabled={busy}>
              <option value="service">
                {t("Servicekonto", "Service account")}
              </option>
              <option value="user">{t("Användare", "User")}</option>
            </select>
          </label>
          {!state.integration.configured && (
            <p className="notice">
              {t(
                "Spara först dina Fortnox-uppgifter under Inställningar.",
                "Save your Fortnox credentials in Settings first.",
              )}
            </p>
          )}
          <Message>{error}</Message>
        </div>
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => ref.current?.close()}
          >
            {t("Avbryt", "Cancel")}
          </button>
          <button
            type="submit"
            disabled={busy || !state.integration.configured}
          >
            {t("Fortsätt till Fortnox", "Continue to Fortnox")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
