import type { ProgramId } from "@fortnox-mcp/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, type InstallationState } from "./api.js";
import {
  AddCompanyDialog,
  CompanyLayout,
  CompanyListPage,
  ProgramConnectionDialog,
  Status,
} from "./company-pages.js";
import {
  ApiCredentials,
  Integration,
  Investigations,
  type Language,
  Login,
  Message,
  type Translate,
} from "./forms.js";
import { Link, usePath } from "./navigation.js";
import { AppShell } from "./shell.js";
import "./style.css";

type Clients = {
  clients: {
    client_id: string;
    companies: { company_id: string; name: string; current: boolean }[];
  }[];
  partial: boolean;
};
function ClientPage({ state, t }: { state: InstallationState; t: Translate }) {
  const [clients, setClients] = useState<Clients | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    void api<Clients>("/admin/clients")
      .then((value) => {
        if (active) setClients(value);
      })
      .catch(() => {
        if (active)
          setError(
            t(
              "Klienternas åtkomst kunde inte hämtas.",
              "Could not load client access.",
            ),
          );
      });
    return () => {
      active = false;
    };
  }, [t]);
  return (
    <>
      <h1>{t("AI-klienter", "AI clients")}</h1>
      <p className="intro">
        {t(
          "Anslut din AI-klient och se vilka företag den fått tillgång till.",
          "Connect your AI client and see its company grants.",
        )}
      </p>
      <section className="content-section">
        <h2>{t("Anslut ChatGPT", "Connect ChatGPT")}</h2>
        <p>
          {t(
            "Skapa en egen anslutning med installationsadressen nedan. Logga in som installationsägare och godkänn begärda behörigheter till företagen.",
            "Create a custom connection with the installation URL below. Sign in as installation owner and approve the requested company access.",
          )}
        </p>
        <code>{state.mcp_url}</code>
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard
              .writeText(state.mcp_url)
              .then(() => setCopied(true))
              .catch(() =>
                setError(
                  t(
                    "Kopiera den synliga adressen manuellt.",
                    "Copy the visible URL manually.",
                  ),
                ),
              )
          }
        >
          {t("Kopiera MCP-adress", "Copy MCP URL")}
        </button>
        <Message>
          {copied ? t("Adressen är kopierad.", "URL copied.") : ""}
        </Message>
      </section>
      <section className="content-section">
        <h2>{t("Företagsgodkännanden", "Company grants")}</h2>
        <p>
          {t(
            "Ett sparat godkännande visar beviljad företagsåtkomst. Det visar inte om klienten har en aktiv inloggning. Nya företag eller utökad åtkomst kräver ett nytt klientgodkännande.",
            "A stored grant shows company access, not whether the client has an active session. New companies or extended access require fresh client consent.",
          )}
        </p>
        <p>
          {t(
            "Förnya åtkomst genom att öppna anslutningens OAuth-godkännande igen i AI-klienten. Samma klientregistrering kan användas. Efter ett nytt godkännande gäller nya token; tidigare token kan inte få den utökade åtkomsten.",
            "Renew access by reopening this connection's OAuth approval in the AI client. The same client registration can be used. New tokens use the new approval; earlier tokens cannot acquire the expanded access.",
          )}
        </p>
        {!clients && !error && (
          <p>{t("Hämtar godkännanden…", "Loading grants…")}</p>
        )}
        {clients && !clients.clients.length && (
          <p>
            {t(
              "Inga företagsgodkännanden finns ännu.",
              "No company grants yet.",
            )}
          </p>
        )}
        {clients?.clients.map((client) => (
          <article className="grant-row" key={client.client_id}>
            <h3>{t("Klient", "Client")}</h3>
            <code>{client.client_id}</code>
            {client.companies.map((c) => (
              <div className="grant-company" key={c.company_id}>
                <Link href={`/admin/companies/${c.company_id}`}>{c.name}</Link>
                <Status positive={c.current}>
                  {c.current
                    ? t("Aktuell företagsåtkomst", "Current company access")
                    : t("Nytt godkännande krävs", "Fresh consent required")}
                </Status>
              </div>
            ))}
          </article>
        ))}
        {clients?.partial && (
          <p className="notice">
            {t(
              "Listan är ofullständig. Högst 100 godkännanden visas.",
              "Partial list: up to 100 grants are shown.",
            )}
          </p>
        )}
        <Message>{error}</Message>
      </section>
    </>
  );
}
function Operations({
  state,
  t,
  perform,
}: {
  state: InstallationState;
  t: Translate;
  perform: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const labels: Record<string, string> = {
    receipt_reconciliation: t(
      "Avstämning av kvittofiler",
      "Receipt file reconciliation",
    ),
    voucher_reconciliation: t(
      "Avstämning av verifikationer",
      "Voucher reconciliation",
    ),
    business_reconciliation: t(
      "Avstämning av skrivutfall",
      "Write outcome reconciliation",
    ),
    writes: t("Bokföringsskrivningar", "Bookkeeping writes"),
    provider_files: t("Fortnox-filer", "Fortnox files"),
    review_host: t("Granskning i AI-klienten", "AI client review"),
    files: t("Tillfällig filhantering", "Temporary file handling"),
  };
  return (
    <>
      <h1>{t("Drift", "Operations")}</h1>
      <p className="intro">
        {t(
          "Installationens funktioner, verifiering och återhämtning.",
          "Installation capabilities, verification and recovery.",
        )}
      </p>
      <section className="content-section">
        <h2>
          {t("Funktioner och verifiering", "Capabilities and verification")}
        </h2>
        <dl>
          {Object.entries(state.capabilities).map(([name, enabled]) => (
            <div key={name}>
              <dt>{labels[name] ?? name}</dt>
              <dd>
                {enabled
                  ? t("Tillgänglig", "Available")
                  : t(
                      "Inte tillgänglig i denna körmiljö",
                      "Unavailable in this runtime",
                    )}
              </dd>
            </div>
          ))}
        </dl>
        <p>
          {t(
            "Grönt serverstatus eller en anslutning godkänner inga finansiella operationer.",
            "A healthy server or connection does not approve financial operations.",
          )}
        </p>
      </section>
      {state.restore && (
        <section className="content-section">
          <h2>{t("Återställning", "Restore")}</h2>
          <p>
            {state.restore.reconciled
              ? t(
                  "Återställningens avstämning är registrerad.",
                  "Restore reconciliation is recorded.",
                )
              : t(
                  "Skrivningar är blockerade tills operatören stämt av hela intervallet som saknas i backupen.",
                  "Writes are blocked until the operator reconciles the entire interval missing from the backup.",
                )}
          </p>
        </section>
      )}
      <section className="content-section">
        <h2>{t("Olösta skrivutfall", "Unresolved write outcomes")}</h2>
        {(state.uncertain_outcomes ?? []).map((outcome) => (
          <article
            className="grant-row"
            key={`${outcome.company_id}-${outcome.kind}-${outcome.id}`}
          >
            <Link href={`/admin/companies/${outcome.company_id}`}>
              {outcome.company_name}
            </Link>
            <p>
              {outcome.kind === "bookkeeping"
                ? t("Verifikation", "Voucher")
                : outcome.kind === "business"
                  ? t("Register eller dokument", "Register or document")
                  : t("Kvitto eller filkoppling", "Receipt or file connection")}
            </p>
            <code>{outcome.id}</code>
            {outcome.stage && (
              <p>
                {t("Berört steg", "Affected step")}:{" "}
                {outcome.stage === "upload"
                  ? t("Uppladdning", "Upload")
                  : outcome.stage === "link"
                    ? t("Filkoppling", "File connection")
                    : t("Verifikation", "Voucher")}
              </p>
            )}
            {((outcome.kind === "bookkeeping" &&
              outcome.recovery_available &&
              state.capabilities.voucher_reconciliation) ||
              (outcome.kind === "business" &&
                state.capabilities.business_reconciliation) ||
              (outcome.kind === "receipt" &&
                outcome.recovery_available &&
                state.capabilities.receipt_reconciliation)) && (
              <button
                type="button"
                onClick={() =>
                  void perform(async () => {
                    const result = await api<{ state: string }>(
                      `/admin/companies/${outcome.company_id}/${outcome.kind === "receipt" ? "receipts" : outcome.kind === "bookkeeping" ? "vouchers" : "business"}/${outcome.id}/reconcile`,
                      {},
                    );
                    setRecoveryMessage(
                      result.state === "succeeded"
                        ? t(
                            "Utfallet har stämts av mot Fortnox.",
                            "The outcome was reconciled against Fortnox.",
                          )
                        : result.state === "applied_different"
                          ? t(
                              "Skrivningen har identifierats i Fortnox med avvikande innehåll. Granska avvikelsen nedan.",
                              "The write was identified in Fortnox with different content. Review the difference below.",
                            )
                          : t(
                              "Utfallet är fortfarande okänt. Ingen ny skrivning har skickats.",
                              "The outcome remains unknown. No new write was sent.",
                            ),
                    );
                  })
                }
              >
                {t("Kontrollera utfallet", "Check outcome")}
              </button>
            )}
            <p>
              {t(
                "Kontrollera status och stäm av utfallet i det befintliga arbetsflödet. Skicka inte ett nytt försök medan utfallet är okänt.",
                "Check status and reconcile the outcome in the existing workflow. Do not send a new attempt while the outcome is unknown.",
              )}
            </p>
          </article>
        ))}
        <Message>{recoveryMessage}</Message>
        {state.investigations.length ? (
          <Investigations state={state} t={t} perform={perform} />
        ) : !(state.uncertain_outcomes ?? []).length ? (
          <p>
            {t(
              "Inga olösta skrivutfall finns registrerade.",
              "No unresolved write outcomes are recorded.",
            )}
          </p>
        ) : null}
      </section>
      {!!state.observed_differences?.length && (
        <section className="content-section">
          <h2>
            {t("Genomfört med avvikelse", "Applied with different content")}
          </h2>
          <p>
            {t(
              "Fortnox har bekräftat skrivningen, men återläsningen avviker från förberedelsen. Detta är inte ett godkänt avsett resultat. Samma skrivning skickas inte igen. Kontrollera resultatet och förbered eventuell rättelse separat.",
              "Fortnox acknowledged the write, but readback differs from preparation. This is not a successful intended result. The same write will not be resent. Review it and prepare any correction separately.",
            )}
          </p>
          {state.observed_differences.map((item) => (
            <article
              className="grant-row"
              key={`${item.company_id}-${item.id}`}
            >
              <Link href={`/admin/companies/${item.company_id}`}>
                {item.company_name}
              </Link>
              <p>{item.operation}</p>
              <p>
                {t("Fortnox-referens", "Fortnox reference")}:{" "}
                <code>{item.reference}</code>
              </p>
              <p>
                {t("Avvikande fält", "Different fields")}:{" "}
                {item.difference.fields.join(", ")}
              </p>
              <details>
                <summary>
                  {t("Visa kontrollhashar", "Show evidence hashes")}
                </summary>
                <p>
                  {t("Förberett", "Expected")}:{" "}
                  <code>{item.difference.expected_digest}</code>
                </p>
                <p>
                  {t("Återläst", "Observed")}:{" "}
                  <code>{item.difference.observed_digest}</code>
                </p>
                <p>
                  {t("Avsikt", "Intent")}: <code>{item.id}</code>
                </p>
              </details>
            </article>
          ))}
        </section>
      )}
      <button
        className="secondary"
        type="button"
        onClick={() =>
          void perform(() => api("/admin/fortnox/cancel-consent", {}))
        }
      >
        {t(
          "Avbryt väntande samtycken i denna session",
          "Cancel pending consents in this session",
        )}
      </button>
    </>
  );
}
function App() {
  const path = usePath();
  const admin = path.startsWith("/admin");
  const [language, setLanguage] = useState<Language>(
    document.cookie.split("; ").includes("ui_language=en") ? "en" : "sv",
  );
  const t: Translate = useCallback(
    (sv, en) => (language === "sv" ? sv : en),
    [language],
  );
  const [state, setState] = useState<InstallationState | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const performing = useRef(false);
  const [adding, setAdding] = useState(false);
  const [program, setProgram] = useState<ProgramId | null>(null);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  const loadVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    const value = await api<InstallationState>("/admin/state");
    if (version === loadVersion.current) setState(value);
  }, []);
  useEffect(() => {
    if (admin)
      void load().catch((e) =>
        setMessage(e instanceof Error ? e.message : "REQUEST_FAILED"),
      );
  }, [admin, path, load]);
  useEffect(() => {
    if (!admin) return;
    const refresh = () =>
      void load().catch((error) =>
        setMessage(error instanceof Error ? error.message : "REQUEST_FAILED"),
      );
    addEventListener("focus", refresh);
    return () => removeEventListener("focus", refresh);
  }, [admin, load]);
  useEffect(() => {
    setProgram(null);
    setAdding(false);
  }, [path]);
  async function perform(action: () => Promise<unknown>) {
    if (performing.current) return;
    performing.current = true;
    setBusy(true);
    setMessage("");
    try {
      await action();
      await load();
      setMessage(t("Uppdaterat.", "Updated."));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "REQUEST_FAILED");
    } finally {
      performing.current = false;
      setBusy(false);
    }
  }
  function changeLanguage() {
    const next = language === "sv" ? "en" : "sv";
    setLanguage(next);
    // biome-ignore lint/suspicious/noDocumentCookie: Non-sensitive preference only; session cookies remain HttpOnly.
    document.cookie = `ui_language=${next}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  }
  const errorMessage = message.includes("OUTCOME_UNKNOWN")
    ? t(
        "Företaget har ett pågående eller okänt skrivutfall. Stäm av utfallet under Drift innan du ändrar programanslutningen.",
        "The company has a pending or unknown write outcome. Reconcile it under Operations before changing program access.",
      )
    : message === "CONSENT_IN_PROGRESS"
      ? t(
          "Slutför det väntande Fortnox-godkännandet, eller avbryt det under Drift innan du startar en ny anslutning.",
          "Complete the pending Fortnox approval, or cancel it under Operations before starting another connection.",
        )
      : message === "SIGN_IN_FAILED"
        ? t(
            "Inloggningen misslyckades. Kontrollera e-post och lösenord.",
            "Sign-in failed. Check your email and password.",
          )
        : message === "AUTH_UNAVAILABLE"
          ? t(
              "Inloggningstjänsten kunde inte skapa en session. Försök igen om en stund.",
              "The sign-in service could not create a session. Try again shortly.",
            )
          : message === "RATE_LIMITED"
            ? t(
                "För många försök. Vänta en minut och försök igen.",
                "Too many attempts. Wait one minute and try again.",
              )
            : message === "AUTH_REQUIRED"
              ? t(
                  "Din session har gått ut. Logga in igen.",
                  "Your session has expired. Sign in again.",
                )
              : /^[A-Z_]+(?:\s*\(.*\))?$/.test(message)
                ? t(
                    "Åtgärden kunde inte slutföras. Kontrollera anslutningen och försök igen.",
                    "Could not complete the action. Check the connection and try again.",
                  )
                : message;
  if (!admin)
    return (
      <div className="auth-page">
        <header className="auth-header">
          <strong>Fortnox MCP</strong>
          <button type="button" className="secondary" onClick={changeLanguage}>
            {t("English", "Svenska")}
          </button>
        </header>
        <main>
          <Login t={t} onError={setMessage} />
          <Message>{errorMessage}</Message>
        </main>
      </div>
    );
  const match = /^\/admin\/companies\/([^/]+)(?:\/([^/]+))?$/.exec(path);
  const company = state?.companies.find((c) => c.company_id === match?.[1]);
  return (
    <AppShell
      path={path}
      t={t}
      language={language}
      onLanguage={changeLanguage}
      onSignOut={() =>
        void api("/auth/sign-out", {})
          .then(() => location.assign("/sign-in"))
          .catch(() => setMessage("AUTH_REQUIRED"))
      }
    >
      {state?.restore && !state.restore.reconciled && (
        <p className="notice">
          {t(
            "Installationen har återställts. Skrivningar är blockerade tills avstämningen är klar.",
            "The installation was restored. Writes remain blocked until reconciliation is complete.",
          )}
        </p>
      )}
      {new URLSearchParams(location.search).has("connection_error") && (
        <p className="notice">
          {t(
            "Fortnox-anslutningen slutfördes inte. Kontrollera företagets anslutning och försök igen.",
            "The Fortnox connection was not completed. Check the company connection and try again.",
          )}
        </p>
      )}
      {!state ? (
        <p>
          {t("Hämtar installationsstatus…", "Loading installation status…")}
        </p>
      ) : (
        <fieldset disabled={busy} className="workspace">
          {path === "/admin/companies" || path === "/admin" ? (
            <CompanyListPage state={state} t={t} add={() => setAdding(true)} />
          ) : match ? (
            company ? (
              <CompanyLayout
                key={company.company_id}
                company={company}
                state={state}
                page={match[2] ?? ""}
                t={t}
                add={() => setAdding(true)}
                connect={setProgram}
                perform={perform}
              />
            ) : (
              <>
                <h1>{t("Företaget hittades inte", "Company not found")}</h1>
                <Link href="/admin/companies">
                  {t("Till företagslistan", "Back to companies")}
                </Link>
              </>
            )
          ) : path === "/admin/ai-clients" ? (
            <ClientPage state={state} t={t} />
          ) : path === "/admin/operations" ? (
            <Operations state={state} t={t} perform={perform} />
          ) : path === "/admin/fortnox/api-credentials" ? (
            <ApiCredentials state={state} t={t} perform={perform} />
          ) : path === "/admin/settings" ? (
            <>
              <h1>{t("Inställningar", "Settings")}</h1>
              <section className="content-section">
                <Integration state={state} t={t} perform={perform} />
              </section>
              <section className="content-section">
                <h2>{t("Installationsägare", "Installation owner")}</h2>
                <p>{state.owner.email}</p>
                <p>
                  {t(
                    "Endast ägaren får ändra integrationsuppgifter och företagspolicy.",
                    "Only the owner may change integration credentials and company policy.",
                  )}
                </p>
                <a href="/reset-password">
                  {t(
                    "Återställ lösenord med privat operatörskod",
                    "Reset password with a private operator code",
                  )}
                </a>
              </section>
            </>
          ) : path === "/admin/help" ? (
            <>
              <h1>{t("Hjälp", "Help")}</h1>
              <section className="content-section">
                <h2>{t("Kom igång", "Getting started")}</h2>
                <ol>
                  <li>
                    <Link href="/admin/settings">
                      {t(
                        "Spara dina egna Fortnox-uppgifter.",
                        "Save your own Fortnox credentials.",
                      )}
                    </Link>
                  </li>
                  <li>
                    <Link href="/admin/companies">
                      {t(
                        "Lägg till företag och välj program.",
                        "Add companies and choose programs.",
                      )}
                    </Link>
                  </li>
                  <li>
                    <Link href="/admin/ai-clients">
                      {t(
                        "Anslut din AI-klient och godkänn företagsåtkomst.",
                        "Connect your AI client and approve company access.",
                      )}
                    </Link>
                  </li>
                </ol>
                <p>
                  <a href="https://github.com/engshort/fortnox-mcp/blob/main/docs/users/kom-igang.sv.md">
                    {t("Användardokumentation", "User documentation")}
                  </a>
                </p>
              </section>
            </>
          ) : (
            <h1>{t("Sidan finns inte", "Page not found")}</h1>
          )}
        </fieldset>
      )}
      <Message>{errorMessage}</Message>
      {message === "AUTH_REQUIRED" && (
        <a href="/sign-in">{t("Logga in", "Sign in")}</a>
      )}
      {adding && state && (
        <AddCompanyDialog state={state} t={t} close={() => setAdding(false)} />
      )}
      {program && company && (
        <ProgramConnectionDialog
          key={`${company.company_id}-${program}`}
          company={company}
          program={program}
          t={t}
          close={() => setProgram(null)}
        />
      )}
    </AppShell>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
