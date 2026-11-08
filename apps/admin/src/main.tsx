import type { ConnectionDiagnosis } from "@fortnox-mcp/fortnox";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { api, type Company, type InstallationState } from "./api.js";
import "./style.css";

type Language = "sv" | "en";
type Translate = (sv: string, en: string) => string;
function Field({
  name,
  label,
  type = "text",
  ...props
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  disabled?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
}) {
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      {label}
      <input id={id} name={name} type={type} required {...props} />
    </label>
  );
}
function Message({ children }: { children: ReactNode }) {
  return (
    <p className="status" role="status" aria-live="polite">
      {children}
    </p>
  );
}
function Diagnosis({ company, t }: { company: string; t: Translate }) {
  const [result, setResult] = useState<ConnectionDiagnosis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const labels: Record<string, string> = {
    available: t("Avgränsad läsning fungerar", "Bounded read available"),
    disconnected: t(
      "Anslutningen behöver återanslutas",
      "Reconnect the connection",
    ),
    missing_permission: t("Nödvändig scope saknas", "Required scope missing"),
    upstream_error: t("Fortnox kunde inte nås", "Provider unavailable"),
    verification_blocked: t("Verifiering återstår", "Verification pending"),
    not_implemented: t("Inte implementerad", "Not implemented"),
    unknown: t(
      "Behörighets- eller licensorsak okänd",
      "Permission or license cause unknown",
    ),
  };
  return (
    <div className="separated">
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            setResult(
              await api<ConnectionDiagnosis>("/admin/fortnox/diagnose", {
                company_id: company,
              }),
            );
          } catch {
            setError(
              t("Diagnostiken kunde inte slutföras.", "Diagnosis failed."),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("Kontrollera anslutning", "Check connection")}
      </button>
      <Message>{error || (result ? labels[result.status] : "")}</Message>
      {result && (
        <>
          <p>
            {result.reason} · {result.correlation_id}
          </p>
          <ul>
            {result.capabilities.map((c) => (
              <li key={c.id}>
                {c.id}: {labels[c.status]}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
function Login({
  t,
  onError,
}: {
  t: Translate;
  onError: (value: string) => void;
}) {
  const setup = location.pathname === "/setup",
    reset = location.pathname === "/reset-password";
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    onError("");
    const form = event.currentTarget,
      data = Object.fromEntries(new FormData(form));
    form.reset();
    try {
      await api(
        reset
          ? "/auth/reset-password"
          : setup
            ? "/admin/bootstrap"
            : "/auth/sign-in/email",
        data,
      );
      if (reset) {
        location.assign("/sign-in");
        return;
      }
      location.assign(
        location.search ? `/auth/oauth2/authorize${location.search}` : "/admin",
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "REQUEST_FAILED");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="login">
      <h1>
        {reset
          ? t("Återställ lösenord", "Reset password")
          : setup
            ? t("Skapa installationsägare", "Create installation owner")
            : t("Logga in", "Sign in")}
      </h1>
      <p>
        {t(
          "Engångskoder utfärdas privat av installationsoperatören. Skicka aldrig koder eller lösenord till ChatGPT.",
          "One-time codes are issued privately by the installation operator. Never send codes or passwords to ChatGPT.",
        )}
      </p>
      <form onSubmit={submit}>
        {(setup || reset) && (
          <Field
            name="token"
            label={t("Engångskod", "One-time code")}
            type="password"
          />
        )}
        {!reset && (
          <Field name="email" label={t("E-post", "Email")} type="email" />
        )}
        <Field
          name={reset ? "newPassword" : "password"}
          label={t("Lösenord", "Password")}
          type="password"
          minLength={12}
          maxLength={128}
        />
        <button type="submit" disabled={busy}>
          {busy
            ? t("Vänta…", "Please wait…")
            : reset
              ? t("Återställ lösenord", "Reset password")
              : setup
                ? t("Skapa ägare", "Create owner")
                : t("Logga in", "Sign in")}
        </button>
      </form>
      <p>
        <a href="/sign-in">{t("Till inloggning", "Sign in")}</a> ·{" "}
        <a href="/reset-password">
          {t("Återställ lösenord", "Reset password")}
        </a>
      </p>
    </section>
  );
}

function Integration({
  state,
  t,
  perform,
}: {
  state: InstallationState;
  t: Translate;
  perform: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const operator = state.integration.source === "operator";
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      body = Object.fromEntries(new FormData(form));
    form.reset();
    void perform(() => api("/admin/fortnox/configuration", body));
  }
  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const mode = new FormData(event.currentTarget).get("mode");
    void perform(async () => {
      const result = await api("/admin/fortnox/start", { mode });
      if (
        !result.url ||
        new URL(result.url).origin !== "https://apps.fortnox.se"
      )
        throw new Error("REQUEST_FAILED");
      location.assign(result.url);
    });
  }
  return (
    <div className="columns">
      <section>
        <h2>{t("Dina Fortnox-uppgifter", "Your Fortnox credentials")}</h2>
        <p>
          {t(
            "Uppgifterna krypteras på servern och visas aldrig i ChatGPT.",
            "Credentials are encrypted on the server and never shown in ChatGPT.",
          )}
        </p>
        {operator ? (
          <p>
            {t(
              "Uppgifterna hanteras av operatören. Ändra den privata serverkonfigurationen för att ersätta dem.",
              "Credentials are operator-managed. Replace them through the private server configuration.",
            )}
          </p>
        ) : (
          <form onSubmit={save}>
            <Field name="client_id" label="Client ID" maxLength={128} />
            <Field
              name="client_secret"
              label="Client Secret"
              type="password"
              minLength={8}
              maxLength={4096}
            />
            <button type="submit">
              {t("Spara uppgifter", "Save credentials")}
            </button>
          </form>
        )}
        {state.integration.configured && (
          <p>
            {t(
              "Uppgifter finns sparade. De återläses inte i formuläret.",
              "Credentials are configured. Saved values are never returned to this form.",
            )}
          </p>
        )}
        <section className="separated">
          <h2>{t("Anslut ett testföretag", "Connect a test company")}</h2>
          <form onSubmit={connect}>
            <fieldset>
              <legend>{t("Anslutningstyp", "Connection type")}</legend>
              <label className="choice">
                <input
                  type="radio"
                  name="mode"
                  value="service"
                  defaultChecked
                />
                {t("Servicekonto", "Service account")}
              </label>
              <label className="choice">
                <input type="radio" name="mode" value="user" />
                {t("Användare", "User")}
              </label>
            </fieldset>
            <button
              type="submit"
              disabled={!state.integration.configured || !state.test_mode}
            >
              {t("Fortsätt till Fortnox", "Continue to Fortnox")}
            </button>
          </form>
          {!state.test_mode && (
            <p>
              {t(
                "Operatören måste först konfigurera två auktoriserade testföretag. Inga produktionskonton.",
                "The operator must first configure two authorized test tenants. No production accounts.",
              )}
            </p>
          )}
        </section>
      </section>
      <aside>
        <h2>{t("I Fortnox", "In Fortnox")}</h2>
        <ol>
          <li>
            {t("Skapa din egen integration.", "Create your own integration.")}
          </li>
          <li>
            {t(
              "Registrera callback-adressen.",
              "Register the callback address.",
            )}
          </li>
          <li>
            {t("Välj nödvändiga behörigheter.", "Select the required scopes.")}
          </li>
        </ol>
        <strong>{t("Callback-adress:", "Callback address:")}</strong>
        <code>{state.callback}</code>
        <p>
          {t(
            "Nytt företag eller nya behörigheter kräver ett nytt klientgodkännande.",
            "New companies or scopes require fresh client consent.",
          )}
        </p>
      </aside>
    </div>
  );
}

function Companies({
  state,
  t,
  perform,
}: {
  state: InstallationState;
  t: Translate;
  perform: (action: () => Promise<unknown>) => Promise<void>;
}) {
  function policy(event: FormEvent<HTMLFormElement>, company: Company) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void perform(() =>
      api("/admin/fortnox/policy", {
        company_id: company.company_id,
        policy_version: company.policy_version,
        review: data.get("review"),
        read_only: data.get("read_only") === "true",
      }),
    );
  }
  return (
    <section>
      <h2>{t("Dina företag", "Your companies")}</h2>
      {!state.companies.length && (
        <p>
          {t("Inga företag är anslutna ännu.", "No companies connected yet.")}
        </p>
      )}
      {state.companies.map((c) => (
        <article
          className="company"
          key={`${c.company_id}-${c.policy_version}`}
        >
          <h3>{c.name}</h3>
          <p>
            {c.state} · {c.mode}
          </p>
          <Diagnosis company={c.company_id} t={t} />
          {c.state === "active" ? (
            <>
              <form onSubmit={(e) => policy(e, c)}>
                <label className="field">
                  {t("Manuella verifikationer", "Manual vouchers")}
                  <select name="review" defaultValue={c.review}>
                    <option value="review_required">
                      {t("Mänsklig granskning krävs", "Human review required")}
                    </option>
                    <option value="client_managed">
                      {t("Klientens godkännanden", "Client-managed approvals")}
                    </option>
                  </select>
                </label>
                <label className="field">
                  {t("Åtkomst", "Access")}
                  <select name="read_only" defaultValue={String(c.read_only)}>
                    <option value="true">
                      {t("Skrivskyddad", "Read only")}
                    </option>
                    <option value="false">
                      {t(
                        "Tillåt verifierade skrivoperationer",
                        "Allow verified write operations",
                      )}
                    </option>
                  </select>
                </label>
                <button type="submit">
                  {t("Spara policy", "Save policy")}
                </button>
              </form>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  void perform(() =>
                    api("/admin/fortnox/disconnect", {
                      company_id: c.company_id,
                    }),
                  )
                }
              >
                {t("Koppla från", "Disconnect")}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() =>
                void perform(async () => {
                  const result = await api("/admin/fortnox/start", {
                    company_id: c.company_id,
                    mode: c.mode,
                  });
                  if (
                    !result.url ||
                    new URL(result.url).origin !== "https://apps.fortnox.se"
                  )
                    throw new Error("REQUEST_FAILED");
                  location.assign(result.url);
                })
              }
            >
              {t("Återanslut", "Reconnect")}
            </button>
          )}
          <p>
            {t(
              "Policyändring ogiltigförklarar gamla förslag och aktiverar ingen overifierad operation.",
              "Policy changes invalidate old proposals and do not enable unverified operations.",
            )}
          </p>
        </article>
      ))}
      {state.investigations.map((ref) => (
        <section className="separated" key={ref.proposal_id}>
          <h3>{t("Utred okänt utfall", "Investigate unknown outcome")}</h3>
          <p>{ref.proposal_id}</p>
          <p>
            {t(
              "Kontrollera den faktiska verifikationen i Fortnox. Datum och belopp räcker inte som identitetsbevis.",
              "Check the actual voucher in Fortnox. Date and amount alone do not prove identity.",
            )}
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void perform(() =>
                api("/admin/fortnox/attest-reference", {
                  proposal: ref,
                  reference: {
                    financial_year: Number(data.get("financial_year")),
                    series: data.get("series"),
                    number: Number(data.get("number")),
                  },
                }),
              );
            }}
          >
            <Field
              name="financial_year"
              label={t("Räkenskapsårs-ID", "Financial year ID")}
              type="number"
              min={1}
            />
            <Field name="series" label={t("Serie", "Series")} />
            <Field
              name="number"
              label={t("Verifikationsnummer", "Voucher number")}
              type="number"
              min={1}
            />
            <button type="submit">
              {t(
                "Registrera kontrollerad referens",
                "Record checked reference",
              )}
            </button>
          </form>
          <p>
            {t(
              "Detta skickar ingen bokföring. Endast exakt återläsning kan lösa utfallet.",
              "This submits no voucher. Only exact provider readback can resolve the outcome.",
            )}
          </p>
        </section>
      ))}
    </section>
  );
}

function App() {
  const [language, setLanguage] = useState<Language>(
    document.cookie.includes("ui_language=en") ? "en" : "sv",
  );
  const [state, setState] = useState<InstallationState | null>(null),
    [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false),
    [tab, setTab] = useState("fortnox");
  const t: Translate = (sv, en) => (language === "sv" ? sv : en);
  const admin = location.pathname === "/admin";
  const load = async () =>
    setState(await api<InstallationState>("/admin/state"));
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  useEffect(() => {
    if (admin)
      void api<InstallationState>("/admin/state")
        .then(setState)
        .catch((error) =>
          setMessage(error instanceof Error ? error.message : "REQUEST_FAILED"),
        );
  }, [admin]);
  async function perform(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await action();
      await load();
      setMessage(t("Uppdaterat.", "Updated."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "REQUEST_FAILED");
    } finally {
      setBusy(false);
    }
  }
  const tabs = [
    ["owner", t("Ägare", "Owner")],
    ["fortnox", "Fortnox"],
    ["companies", t("Företag", "Companies")],
    ["chatgpt", "ChatGPT"],
    ["status", "Status"],
  ];
  return (
    <>
      <header>
        <div>
          <strong>Fortnox MCP</strong>
          <div className="header-actions">
            <button
              type="button"
              onClick={() => {
                const next = language === "sv" ? "en" : "sv";
                setLanguage(next);
                // biome-ignore lint/suspicious/noDocumentCookie: This is only a non-sensitive language preference; auth cookies remain HttpOnly.
                document.cookie = `ui_language=${next}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
              }}
            >
              {t("English", "Svenska")}
            </button>
            {admin && (
              <button
                type="button"
                onClick={() =>
                  void api("/auth/sign-out", {})
                    .then(() => location.assign("/sign-in"))
                    .catch(() => setMessage("AUTH_REQUIRED"))
                }
              >
                {t("Logga ut", "Sign out")}
              </button>
            )}
          </div>
        </div>
      </header>
      <main>
        {!admin ? (
          <Login t={t} onError={setMessage} />
        ) : (
          <>
            <h1>{t("Din installation", "Your installation")}</h1>
            <p className="intro">
              {t(
                "Anslut Fortnox och välj vilka företag din AI-klient får använda.",
                "Connect Fortnox and choose which companies your AI client may use.",
              )}
            </p>
            <nav aria-label={t("Installationssteg", "Installation steps")}>
              {tabs.map(([id, label]) => (
                <button
                  type="button"
                  key={id}
                  aria-current={tab === id ? "step" : undefined}
                  onClick={() => setTab(id ?? "fortnox")}
                >
                  {label}
                </button>
              ))}
            </nav>
            <p className="notice">
              {t(
                "Bokföring och Fortnox-filer är avstängda tills verifieringen är klar.",
                "Bookkeeping and Fortnox files are disabled until verification is complete.",
              )}
            </p>
            {!state ? (
              <p>
                {t(
                  "Hämtar installationsstatus…",
                  "Loading installation status…",
                )}
              </p>
            ) : (
              <fieldset className="workspace" disabled={busy}>
                {tab === "owner" && (
                  <section>
                    <h2>{t("Installationsägare", "Installation owner")}</h2>
                    <p>{state.owner.email}</p>
                    <p>
                      {t(
                        "Endast den här ägarens session får ändra credentials och företagspolicy.",
                        "Only this owner's session may change credentials and company policies.",
                      )}
                    </p>
                    <a href="/reset-password">
                      {t(
                        "Återställ lösenord med privat operatörskod",
                        "Reset password with a private operator code",
                      )}
                    </a>
                  </section>
                )}
                {tab === "fortnox" && (
                  <Integration state={state} t={t} perform={perform} />
                )}
                {tab === "companies" && (
                  <Companies state={state} t={t} perform={perform} />
                )}
                {tab === "chatgpt" && (
                  <section>
                    <h2>{t("Anslut ChatGPT", "Connect ChatGPT")}</h2>
                    <p>
                      {t(
                        "Skapa en egen anslutning med installationsadressen nedan. Logga in som installationsägare och godkänn endast de behörigheter och företag du vill ge klienten.",
                        "Create a custom connection with the installation URL below. Sign in as installation owner and consent only to the scopes and companies you intend to grant.",
                      )}
                    </p>
                    <code>{state.mcp_url}</code>
                    <button
                      type="button"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(state.mcp_url)
                          .then(() =>
                            setMessage(
                              t("Adressen är kopierad.", "URL copied."),
                            ),
                          )
                          .catch(() =>
                            setMessage(
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
                    <p>
                      {t(
                        "Nya företag och fil-/skrivbehörigheter kräver nytt godkännande. Klientstöd gäller endast faktiskt verifierad miljö.",
                        "New companies and file/write scopes require new consent. Client support applies only to actually verified environments.",
                      )}
                    </p>
                  </section>
                )}
                {tab === "status" && (
                  <section>
                    <h2>
                      {t(
                        "Funktioner och verifiering",
                        "Capabilities and verification",
                      )}
                    </h2>
                    <dl>
                      {Object.entries(state.capabilities).map(
                        ([name, enabled]) => (
                          <div key={name}>
                            <dt>{name}</dt>
                            <dd>
                              {enabled
                                ? t(
                                    "Tillgänglig i testomfånget",
                                    "Available within test scope",
                                  )
                                : t(
                                    "Avstängd – verifiering återstår",
                                    "Disabled — verification pending",
                                  )}
                            </dd>
                          </div>
                        ),
                      )}
                    </dl>
                    <p>
                      {t(
                        "Grönt serverstatus eller sparade credentials godkänner inga finansiella operationer.",
                        "A healthy server or saved credentials do not approve financial operations.",
                      )}
                    </p>
                  </section>
                )}
              </fieldset>
            )}
          </>
        )}
        <Message>{message}</Message>
      </main>
      <footer>
        {t(
          "Egna credentials. Egen hosting. AGPL-3.0-only.",
          "Your credentials. Your hosting. AGPL-3.0-only.",
        )}
      </footer>
    </>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
