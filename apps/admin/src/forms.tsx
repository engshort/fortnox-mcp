import type { ConnectionDiagnosis } from "@fortnox-mcp/fortnox";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { api, type Company, type InstallationState } from "./api.js";

export type Language = "sv" | "en";
export type Translate = (sv: string, en: string) => string;
export function Field({
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
export function Message({ children }: { children: ReactNode }) {
  return (
    <p className="status" role="status" aria-live="polite">
      {children}
    </p>
  );
}
export function Diagnosis({ company, t }: { company: string; t: Translate }) {
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
export function Login({
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
    // Clear secrets promptly while preserving the email for a failed retry.
    for (const field of form.querySelectorAll<HTMLInputElement>(
      'input[type="password"]',
    ))
      field.value = "";
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

export function ApiCredentials({
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
    void perform(async () => {
      await api("/admin/fortnox/configuration", body);
      location.assign("/admin/settings");
    });
  }
  return (
    <section className="login">
      <p>
        <a href="/admin">
          {t("Till administrationen", "Back to administration")}
        </a>
      </p>
      <h1>{t("Dina Fortnox-uppgifter", "Your Fortnox credentials")}</h1>
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
    </section>
  );
}

export function Integration({
  state,
  t,
  perform,
}: {
  state: InstallationState;
  t: Translate;
  perform: (action: () => Promise<unknown>) => Promise<void>;
}) {
  return (
    <div className="columns">
      <section>
        <h2>Fortnox API</h2>
        <p className={state.integration.verified ? "connection-approved" : ""}>
          {state.integration.verified
            ? t("Godkänd", "Approved")
            : state.integration.configured
              ? t(
                  "Sparade uppgifter – väntar på godkänd anslutning",
                  "Credentials saved — awaiting an approved connection",
                )
              : t("API-uppgifter saknas", "API credentials required")}
        </p>
        {state.integration.verified && state.integration.source === "owner" ? (
          <button
            type="button"
            className="secondary"
            onClick={() =>
              void perform(() =>
                api("/admin/fortnox/forget-configuration", {
                  revision: state.integration.revision,
                }),
              )
            }
          >
            {t("Glöm", "Forget")}
          </button>
        ) : !state.integration.verified ? (
          <a href="/admin/fortnox/api-credentials">
            {t("Ange Fortnox API uppgifter", "Enter Fortnox API credentials")}
          </a>
        ) : null}
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

export function Companies({
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
      <h2>{t("Åtkomst och policy", "Access and policy")}</h2>
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
    </section>
  );
}

export function Investigations({
  state,
  t,
  perform,
}: {
  state: InstallationState;
  t: Translate;
  perform: (action: () => Promise<unknown>) => Promise<void>;
}) {
  return (
    <section>
      {" "}
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
