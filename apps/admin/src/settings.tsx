import type { InstallationKey, InstallationValues } from "@fortnox-mcp/core";
import { type FormEvent, useEffect, useId, useState } from "react";
import { ApiError, api, type InstallationState } from "./api.js";
import { Integration, type Translate } from "./forms.js";
import { Link } from "./navigation.js";

type PublicValues = Omit<InstallationValues, "emailApiKey"> & {
  emailApiKey: boolean;
};
interface SettingsState {
  owner_recovery_email: boolean;
  revision: number | null;
  values: PublicValues;
  sources: Record<InstallationKey, "app" | "server" | "default">;
  can_install_catalog: boolean;
  catalog: {
    revision: string | null;
    operations: number;
    unavailable: boolean;
  };
  availability: Partial<Record<InstallationKey, string | null>>;
  runtime: {
    kind: string;
    origin: string;
    redirects: string[];
    file_transport: string;
    file_sources_configured: boolean;
  };
}
interface ClientOption {
  client_id: string;
  name: string;
  onboarding: boolean;
  offline: boolean;
}
interface ClientPage {
  clients: ClientOption[];
  next: string | null;
}
const groups = {
  email: ["emailEnabled", "emailFrom", "emailApiKey"],
  users: ["multiUser", "membershipProvisioning"],
  integrations: [
    "restApi",
    "restBridge",
    "restSync",
    "fortnoxEvents",
    "externalAppOnboarding",
    "onboardingClients",
    "offlineClientIds",
  ],
  analysis: ["financialAnalysisContexts", "financialLargeReads"],
} as const satisfies Record<string, readonly InstallationKey[]>;
type Group = keyof typeof groups;

function labels(t: Translate): Record<InstallationKey, string> {
  return {
    emailEnabled: t("Skicka kontomejl", "Send account emails"),
    emailApiKey: t("Resend API-nyckel", "Resend API key"),
    emailFrom: t("Avsändaradress", "Sender address"),
    multiUser: t("Fleranvändarstöd", "Multiple users"),
    membershipProvisioning: t(
      "Medlemssynkronisering via API",
      "Membership provisioning API",
    ),
    restApi: t("REST-API", "REST API"),
    restBridge: t("REST-brygga", "REST bridge"),
    restSync: t("Företagssynk", "Company sync"),
    fortnoxEvents: t(
      "Realtidshändelser från Fortnox",
      "Fortnox realtime events",
    ),
    externalAppOnboarding: t(
      "Företagsanslutning från externa appar",
      "External application company onboarding",
    ),
    onboardingClients: t(
      "Tillåtna appar för företagsanslutning",
      "Allowed onboarding applications",
    ),
    offlineClientIds: t(
      "Backendklienter med 30 dagars åtkomst",
      "Backends with 30-day access",
    ),
    financialAnalysisContexts: t(
      "Återanvändbara analysunderlag",
      "Reusable analysis contexts",
    ),
    financialLargeReads: t(
      "Större analysinläsningar",
      "Larger analysis inputs",
    ),
  };
}
function availability(reason: string | null | undefined, t: Translate) {
  const messages: Record<string, string> = {
    multi_user_required: t(
      "Kräver fleranvändarstöd.",
      "Requires multiple users.",
    ),
    rest_api_required: t("Kräver REST-API.", "Requires REST API."),
    rest_bridge_required: t(
      "Kräver REST-API och REST-brygga.",
      "Requires REST API and bridge.",
    ),
    catalog_required: t(
      "En granskad REST-katalog saknas.",
      "A reviewed REST catalogue is required.",
    ),
    catalog_unavailable: t(
      "Katalogen kan inte läsas. Installationsägaren kan installera ett granskat paket på nytt.",
      "The catalogue cannot be read. The owner can install a reviewed bundle again.",
    ),
    node_required: t(
      "Kräver Node/Docker. Realtid är inte tillgänglig på Worker.",
      "Requires Node/Docker. Realtime is unavailable on Worker.",
    ),
    sync_required: t(
      "Kräver aktiverad företagssynk, REST-API och REST-brygga.",
      "Requires company sync, REST API and bridge.",
    ),
    analysis_storage_required: t(
      "Lagring för analysunderlag saknas.",
      "Analysis context storage is unavailable.",
    ),
  };
  return reason
    ? (messages[reason] ??
        t("Funktionen är inte tillgänglig.", "Feature unavailable."))
    : "";
}
function errorText(error: unknown, t: Translate) {
  const code = error instanceof Error ? error.message : "";
  if (code === "CONNECTION_CONFLICT")
    return t(
      "Inställningarna har ändrats i en annan session. Hämta aktuella värden innan du sparar igen.",
      "Settings changed in another session. Load current values before saving again.",
    );
  if (code === "AUTH_REQUIRED")
    return t(
      "Din administratörsåtkomst är inte längre aktiv. Logga in igen eller kontakta installationsägaren.",
      "Your administrator access is no longer active. Sign in again or contact the owner.",
    );
  if (code === "VALIDATION_FAILED")
    return t(
      "Kontrollera de markerade fälten och funktionernas beroenden.",
      "Check the highlighted fields and feature dependencies.",
    );
  return t(
    "Åtgärden kunde inte bekräftas. Hämta aktuella värden och kontrollera resultatet innan du försöker igen.",
    "The outcome could not be confirmed. Load current values and check the result before trying again.",
  );
}
function SettingsSection({
  group,
  snapshot,
  clients,
  t,
  saved,
  reload,
}: {
  group: Group;
  snapshot: SettingsState;
  clients: ClientOption[];
  t: Translate;
  saved: () => Promise<SettingsState>;
  reload: () => Promise<void>;
}) {
  const fields = groups[group];
  const names = labels(t);
  const id = useId();
  const [draft, setDraft] = useState(snapshot.values);
  const [reset, setReset] = useState<InstallationKey[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [invalid, setInvalid] = useState<string[]>([]);
  const sourceText = {
    app: t("Sparat i appen", "Saved in app"),
    server: t("Serverkonfiguration", "Server configuration"),
    default: t("Standardvärde", "Default value"),
  };
  const title = {
    email: t("E-post", "Email"),
    users: t("Användare", "Users"),
    integrations: t("Integrationer", "Integrations"),
    analysis: t("Analys", "Analysis"),
  }[group];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const secret = form.querySelector<HTMLInputElement>(
      'input[type="password"]',
    );
    if (secret) secret.value = "";
    if (data.get("clearApiKey") === "on" && data.get("emailApiKey")) {
      setInvalid(["emailApiKey"]);
      setMessage(
        t(
          "Välj antingen att ange en ny API-nyckel eller att radera den befintliga.",
          "Choose either a replacement API key or clearing the existing key.",
        ),
      );
      return;
    }
    const changes: Partial<InstallationValues> = Object.fromEntries(
      fields
        .filter(
          (key) =>
            key !== "emailApiKey" &&
            !reset.includes(key) &&
            JSON.stringify(draft[key]) !== JSON.stringify(snapshot.values[key]),
        )
        .map((key) => [key, draft[key]]),
    );
    if (group === "email" && !reset.includes("emailApiKey")) {
      if (data.get("clearApiKey") === "on") changes.emailApiKey = "";
      else if (data.get("emailApiKey"))
        changes.emailApiKey = String(data.get("emailApiKey")).trim();
    }
    setBusy(true);
    setMessage("");
    setInvalid([]);
    let committed = false;
    try {
      await api("/admin/settings", {
        expected_revision: snapshot.revision,
        changes,
        reset,
      });
      committed = true;
      const current = await saved();
      setDraft(current.values);
      setReset([]);
      const clear = form.querySelector<HTMLInputElement>(
        'input[name="clearApiKey"]',
      );
      if (clear) clear.checked = false;
      setMessage(
        t(
          "Sparat. Ändringarna gäller direkt.",
          "Saved. Changes take effect immediately.",
        ),
      );
    } catch (error) {
      setMessage(
        committed && error instanceof Error && error.message !== "AUTH_REQUIRED"
          ? t(
              "Inställningarna sparades, men aktuell status kunde inte hämtas. Hämta aktuella värden innan du gör fler ändringar.",
              "Settings were saved, but current status could not be loaded. Load current values before making more changes.",
            )
          : committed
            ? t(
                "Inställningarna sparades. Din administratörsåtkomst är inte längre aktiv; installationsägaren kan hantera inställningarna.",
                "Settings were saved. Your administrator access is no longer active; the installation owner can manage settings.",
              )
            : errorText(error, t),
      );
      setInvalid(error instanceof ApiError ? error.fields : []);
    } finally {
      setBusy(false);
    }
  }
  function resetField(key: InstallationKey) {
    setReset((current) =>
      current.includes(key)
        ? current.filter((k) => k !== key)
        : [...current, key],
    );
  }
  return (
    <section
      className="content-section settings-section"
      id={group}
      aria-labelledby={`${id}-title`}
    >
      <h2 id={`${id}-title`}>{title}</h2>
      <p className="muted">
        {
          {
            email: t(
              "Kontomejl används för välkomstmeddelanden och lösenordsåterställning. Verifiera avsändarens domän hos Resend innan du aktiverar utskick.",
              "Account emails provide welcome messages and password recovery. Verify the sender domain with Resend before enabling delivery.",
            ),
            users: t(
              "Medlemssynkronisering kräver fleranvändarstöd. Om du stänger av fleranvändarstöd förlorar administratörer och medlemmar sin åtkomst; ägaren kan fortfarande logga in. Medlemsuppgifter behålls.",
              "Provisioning requires multiple users. Disabling multiple users removes administrator and member access; the owner can still sign in. Membership records are retained.",
            ),
            integrations: t(
              "REST-bryggan kräver REST-API. Företagssynk kräver båda, och realtid kräver dessutom Node/Docker. Spara beroende reglage tillsammans. Aktivering ger inga nya företagsbehörigheter eller medgivanden.",
              "The bridge requires REST API. Sync requires both, and realtime also requires Node/Docker. Save dependent switches together. Activation grants no new company permissions or consent.",
            ),
            analysis: t(
              "Analysunderlag återanvänder ett tidsbegränsat dataunderlag. Större inläsningar höjer gränsen från 2 till 16 MiB per SIE-export och från 10 000 till 100 000 rörelser. Separata minnes- och tidsgränser gäller fortfarande.",
              "Analysis contexts reuse a time-limited dataset. Larger inputs raise the limit from 2 to 16 MiB per SIE export and from 10,000 to 100,000 movements. Separate memory and time limits still apply.",
            ),
          }[group]
        }
      </p>
      {group === "email" &&
        snapshot.values.emailEnabled &&
        !snapshot.owner_recovery_email && (
          <p className="notice">
            {t(
              "Ägarens återställningsmejl är avstängda för denna nyckel. Installationsägaren behöver ange en egen API-nyckel, eller återställa till operatörens nyckel. Övriga kontomejl kan fortfarande användas.",
              "Owner recovery emails are disabled for this key. The owner must enter their own API key, or restore the operator key. Other account emails can still be used.",
            )}
          </p>
        )}
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          {fields.map((key) => {
            const value = draft[key];
            const fieldId = `${id}-${key}`;
            const hint = `${fieldId}-hint`;
            const restoring = reset.includes(key);
            return (
              <div className="settings-field" key={key}>
                {key === "emailApiKey" ? (
                  <>
                    <label htmlFor={fieldId}>{names[key]}</label>
                    <p className="muted">
                      {snapshot.values.emailApiKey
                        ? t(
                            "API-nyckel konfigurerad. Ange endast en ny nyckel om den ska ersättas.",
                            "API key configured. Enter a new key only to replace it.",
                          )
                        : t("API-nyckel saknas.", "API key missing.")}
                    </p>
                    <input
                      id={fieldId}
                      name="emailApiKey"
                      type="password"
                      autoComplete="new-password"
                      maxLength={4096}
                      disabled={restoring}
                      aria-invalid={invalid.includes(key)}
                      aria-describedby={hint}
                    />
                    <label className="settings-check">
                      <input
                        type="checkbox"
                        name="clearApiKey"
                        disabled={restoring}
                      />
                      {t("Radera sparad API-nyckel", "Clear API key")}
                    </label>
                  </>
                ) : Array.isArray(value) ? (
                  <fieldset
                    className="settings-client-list"
                    disabled={restoring}
                    aria-describedby={hint}
                    aria-invalid={invalid.includes(key)}
                  >
                    <legend>{names[key]}</legend>
                    {[
                      ...clients,
                      ...value
                        .filter(
                          (clientId) =>
                            !clients.some((c) => c.client_id === clientId),
                        )
                        .map((client_id) => ({
                          client_id,
                          name: t(
                            "Tidigare vald klient",
                            "Previously selected client",
                          ),
                          onboarding: false,
                          offline: false,
                        })),
                    ].map((client) => {
                      const eligible =
                        key === "onboardingClients"
                          ? client.onboarding
                          : client.offline;
                      const selected = value.includes(client.client_id);
                      return (
                        <label
                          key={client.client_id}
                          className="settings-client-option"
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={!eligible && !selected}
                            onChange={(event) =>
                              setDraft((old) => ({
                                ...old,
                                [key]: event.target.checked
                                  ? [...value, client.client_id]
                                  : value.filter((c) => c !== client.client_id),
                              }))
                            }
                          />
                          <span className="settings-client-name">
                            {client.name}
                            <small>{client.client_id}</small>
                            {!eligible && (
                              <small>
                                {t(
                                  "Inte valbar med nuvarande registrering.",
                                  "Not eligible with its current registration.",
                                )}
                              </small>
                            )}
                          </span>
                        </label>
                      );
                    })}
                    {!clients.length && !value.length && (
                      <p>
                        {t(
                          "Inga registrerade backendklienter har hämtats.",
                          "No registered backends loaded.",
                        )}
                      </p>
                    )}
                  </fieldset>
                ) : typeof value === "boolean" ? (
                  <label className="settings-check">
                    <input
                      id={fieldId}
                      type="checkbox"
                      checked={value}
                      disabled={
                        restoring ||
                        (key === "fortnoxEvents" &&
                          snapshot.runtime.kind !== "node" &&
                          !value)
                      }
                      aria-invalid={invalid.includes(key)}
                      aria-describedby={hint}
                      onChange={(event) =>
                        setDraft((old) => ({
                          ...old,
                          [key]: event.target.checked,
                        }))
                      }
                    />
                    {names[key]}
                  </label>
                ) : (
                  <>
                    <label htmlFor={fieldId}>{names[key]}</label>
                    <input
                      id={fieldId}
                      type="email"
                      value={value}
                      disabled={restoring}
                      maxLength={254}
                      aria-invalid={invalid.includes(key)}
                      aria-describedby={hint}
                      onChange={(event) =>
                        setDraft((old) => ({
                          ...old,
                          [key]: event.target.value,
                        }))
                      }
                    />
                  </>
                )}
                <div id={hint} className="settings-hint">
                  <small>
                    {sourceText[snapshot.sources[key]]}
                    {snapshot.availability[key]
                      ? ` · ${snapshot.values[key] === true ? t("Aktiverad – ", "Enabled — ") : ""}${availability(snapshot.availability[key], t)}`
                      : ""}
                  </small>
                  {snapshot.sources[key] === "app" && (
                    <button
                      type="button"
                      className="text-button"
                      aria-pressed={restoring}
                      onClick={() => resetField(key)}
                    >
                      {restoring
                        ? t("Behåll appvärdet", "Keep app value")
                        : t(
                            "Återställ till servervärde vid sparning",
                            "Use server value when saving",
                          )}
                    </button>
                  )}
                  {restoring && (
                    <small>
                      {t(
                        "Serverns grundvärde används efter sparning.",
                        "The server default will apply after saving.",
                      )}
                    </small>
                  )}
                  {invalid.includes(key) && (
                    <span className="settings-error">
                      {t(
                        "Kontrollera värdet och dess förutsättningar.",
                        "Check the value and its prerequisites.",
                      )}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {group === "integrations" && (
            <p>
              {t(
                "30-dagarspolicyn kräver ett separat offline_access-medgivande. Borttagning spärrar befintlig frikopplad åtkomst; återaktivering kan göra fortfarande giltiga tokenfamiljer användbara igen. Permanent återkallelse är en separat åtgärd.",
                "The 30-day policy requires separate offline_access consent. Removing a client fences existing detached access; re-enabling may restore still-valid token families. Permanent revocation is a separate action.",
              )}
            </p>
          )}
          <button type="submit">
            {busy
              ? t("Sparar…", "Saving…")
              : t(
                  `Spara ${title.toLowerCase()}`,
                  `Save ${title.toLowerCase()}`,
                )}
          </button>
        </fieldset>
      </form>
      {message && (
        <p role="status" className="settings-message">
          {message}
        </p>
      )}
      {message && (
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            void reload().catch((error) => setMessage(errorText(error, t)));
          }}
        >
          {t("Hämta aktuella värden", "Load current values")}
        </button>
      )}
      {group === "users" && snapshot.values.multiUser && (
        <p className="settings-links">
          <Link href="/admin/members">
            {t("Hantera medlemmar", "Manage members")}
          </Link>{" "}
          ·{" "}
          <Link href="/admin/membership-sources">
            {t(
              "Hantera medlemsintegrationer",
              "Manage membership integrations",
            )}
          </Link>
        </p>
      )}
      {group === "integrations" && (
        <p className="settings-links">
          <Link href="/admin/ai-clients">
            {t(
              "Visa AI-klienter och företagsgodkännanden",
              "View AI clients and company grants",
            )}
          </Link>
        </p>
      )}
    </section>
  );
}

function Catalog({
  snapshot,
  t,
  saved,
}: {
  snapshot: SettingsState;
  t: Translate;
  saved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const id = useId();
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("catalog");
    if (!(file instanceof File) || !file.size || file.size > 8 * 1024 * 1024) {
      setMessage(
        t(
          "Välj ett granskat JSON-paket på högst 8 MiB.",
          "Choose a reviewed JSON bundle of at most 8 MiB.",
        ),
      );
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await api(
        "/admin/fortnox/bridge-catalog",
        JSON.parse(await file.text()),
        "PUT",
      );
      form.reset();
      await saved();
      setMessage(t("Katalogen är installerad.", "Catalogue installed."));
    } catch (error) {
      setMessage(errorText(error, t));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="content-section settings-section"
      aria-labelledby={`${id}-title`}
    >
      <h2 id={`${id}-title`}>
        {t("Granskad REST-katalog", "Reviewed REST catalogue")}
      </h2>
      <p>
        {snapshot.catalog.unavailable ? (
          t(
            "Katalogen kan inte läsas. Inställningarna kan fortfarande ändras och ägaren kan installera ett granskat paket.",
            "The catalogue cannot be read. Settings can still be changed and the owner can install a reviewed bundle.",
          )
        ) : snapshot.catalog.revision ? (
          <>
            {t("Installerad revision", "Installed revision")}:{" "}
            <code>{snapshot.catalog.revision}</code> ·{" "}
            {snapshot.catalog.operations} {t("operationer", "operations")}
          </>
        ) : (
          t("Ingen katalog installerad.", "No catalogue installed.")
        )}
      </p>
      <p>
        {t(
          "Ladda upp ett färdiggranskat katalogpaket. Uppladdningen är ingen granskning eller verifiering av Fortnox-operationerna.",
          "Upload an already reviewed catalogue bundle. Uploading does not review or verify Fortnox operations.",
        )}
      </p>
      {snapshot.can_install_catalog ? (
        <form onSubmit={upload}>
          <fieldset
            disabled={
              busy || !snapshot.values.restApi || !snapshot.values.restBridge
            }
          >
            <label htmlFor={`${id}-file`}>
              {t("Granskat katalogpaket", "Reviewed catalogue bundle")}
            </label>
            <input
              id={`${id}-file`}
              name="catalog"
              type="file"
              accept="application/json,.json"
              required
            />
            <button type="submit">
              {busy
                ? t("Installerar…", "Installing…")
                : t("Installera katalog", "Install catalogue")}
            </button>
          </fieldset>
          {(!snapshot.values.restApi || !snapshot.values.restBridge) && (
            <p>
              {t(
                "Aktivera och spara REST-API och REST-brygga först.",
                "Enable and save REST API and bridge first.",
              )}
            </p>
          )}
        </form>
      ) : (
        <p>
          {t(
            "Endast installationsägaren kan installera katalogen.",
            "Only the installation owner can install the catalogue.",
          )}
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}

export function SettingsPage({
  state,
  t,
  perform,
}: {
  state: InstallationState;
  t: Translate;
  perform: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<SettingsState | null>(null);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [nextClients, setNextClients] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [loadingClients, setLoadingClients] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([
      api<SettingsState>("/admin/settings"),
      api<ClientPage>("/admin/settings/clients"),
    ])
      .then(([value, registrations]) => {
        if (active) {
          setSnapshot(value);
          setClients(registrations.clients);
          setNextClients(registrations.next);
        }
      })
      .catch(() => {
        if (active) setError("REQUEST_FAILED");
      });
    return () => {
      active = false;
    };
  }, []);
  async function load() {
    const current = await api<SettingsState>("/admin/settings");
    setSnapshot(current);
    return current;
  }
  async function reload() {
    await load();
    setReloadKey((key) => key + 1);
  }
  return (
    <>
      <h1>{t("Inställningar", "Settings")}</h1>
      <p className="intro">
        {t(
          "Hantera installationens funktioner. Sparade ändringar gäller direkt för alla företag och användare.",
          "Manage installation features. Saved changes take effect immediately for all companies and users.",
        )}
      </p>
      <nav
        className="settings-nav"
        aria-label={t("Inställningsområden", "Settings sections")}
      >
        <a href="#fortnox">Fortnox</a>
        <a href="#email">{t("E-post", "Email")}</a>
        <a href="#users">{t("Användare", "Users")}</a>
        <a href="#integrations">{t("Integrationer", "Integrations")}</a>
        <a href="#analysis">{t("Analys", "Analysis")}</a>
      </nav>
      <section id="fortnox" className="content-section">
        <Integration state={state} t={t} perform={perform} />
      </section>
      {error && <p role="alert">{errorText(new Error(error), t)}</p>}
      {!snapshot && !error && (
        <p role="status">{t("Hämtar inställningar…", "Loading settings…")}</p>
      )}
      {snapshot && (
        <>
          {(Object.keys(groups) as Group[]).map((group) => (
            <SettingsSection
              key={`${group}:${reloadKey}`}
              group={group}
              snapshot={snapshot}
              clients={clients}
              t={t}
              reload={reload}
              saved={async () => {
                const current = await load();
                void perform(async () => {});
                return current;
              }}
            />
          ))}
          {nextClients && (
            <button
              type="button"
              className="secondary"
              disabled={loadingClients}
              onClick={() => {
                setLoadingClients(true);
                void api<ClientPage>(
                  `/admin/settings/clients?after=${encodeURIComponent(nextClients)}`,
                )
                  .then((page) => {
                    setClients((old) => [...old, ...page.clients]);
                    setNextClients(page.next);
                  })
                  .catch(() => setError("REQUEST_FAILED"))
                  .finally(() => setLoadingClients(false));
              }}
            >
              {t(
                "Hämta fler registrerade klienter",
                "Load more registered clients",
              )}
            </button>
          )}
          <Catalog
            snapshot={snapshot}
            t={t}
            saved={async () => {
              await load();
            }}
          />
        </>
      )}
      <section className="content-section">
        <h2>{t("Installationsägare", "Installation owner")}</h2>
        <p>{state.owner.email}</p>
        <a href="/reset-password">
          {t("Återställ lösenord", "Reset password")}
        </a>
      </section>
    </>
  );
}

export function RuntimeSettings({ t }: { t: Translate }) {
  const [snapshot, setSnapshot] = useState<SettingsState | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void api<SettingsState>("/admin/settings")
      .then((data) => {
        if (active) setSnapshot(data);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <section className="content-section">
      <h2>{t("Serverkonfiguration", "Server configuration")}</h2>
      {!snapshot ? (
        <p>
          {failed
            ? t(
                "Konfigurationen kunde inte hämtas.",
                "Could not load configuration.",
              )
            : t("Hämtar…", "Loading…")}
        </p>
      ) : (
        <>
          <dl className="runtime-settings">
            <div>
              <dt>{t("Körmiljö", "Runtime")}</dt>
              <dd>{snapshot.runtime.kind}</dd>
            </div>
            <div>
              <dt>{t("Publik adress", "Public URL")}</dt>
              <dd>{snapshot.runtime.origin}</dd>
            </div>
            <div>
              <dt>
                {t("Tillåtna klientcallbacks", "Allowed client callbacks")}
              </dt>
              <dd>
                {snapshot.runtime.redirects.map((uri) => (
                  <div key={uri}>{uri}</div>
                ))}
              </dd>
            </div>
            <div>
              <dt>{t("Filtransport", "File transport")}</dt>
              <dd>{snapshot.runtime.file_transport}</dd>
            </div>
            <div>
              <dt>{t("Filkällor", "File sources")}</dt>
              <dd>
                {snapshot.runtime.file_sources_configured
                  ? t("Konfigurerade", "Configured")
                  : t("Saknas", "Missing")}
              </dd>
            </div>
          </dl>
          <p>
            {t(
              "Dessa värden hanteras av installationsoperatören. Funktionsinställningar ändras under Inställningar.",
              "These values are managed by the operator. Feature settings are managed in Settings.",
            )}
          </p>
          <Link href="/admin/settings">
            {t("Hantera funktionsinställningar", "Manage feature settings")}
          </Link>
        </>
      )}
    </section>
  );
}
