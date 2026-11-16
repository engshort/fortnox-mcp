import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { api, type Company } from "./api.js";
import { Field, Message, type Translate } from "./forms.js";

interface Member {
  id: string;
  user_id: string | null;
  source: string;
  external_id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  active: boolean;
  blocked: boolean;
  revision: number;
  companies: Record<string, "read" | "read_write">;
}
interface Source {
  id: string;
  name: string;
  active: boolean;
  revision: number;
  allowAdmins: boolean;
  companies: string[];
}
interface MembersState {
  members: Member[];
  sources: Source[];
  role: string;
  provisioning: boolean;
}
function companyChoices(form: HTMLFormElement) {
  return Object.fromEntries(
    [...form.querySelectorAll<HTMLSelectElement>("select[data-company]")]
      .filter((s) => s.value)
      .map((s) => [s.dataset.company, s.value]),
  );
}
function CompanyAccess({
  companies,
  member,
  t,
}: {
  companies: Company[];
  member: Member | null;
  t: Translate;
}) {
  return (
    <fieldset>
      <legend>{t("Företagsåtkomst", "Company access")}</legend>
      {companies.map((c) => (
        <label className="field" key={c.company_id}>
          {c.name}
          <select
            aria-label={c.name}
            data-company={c.company_id}
            defaultValue={member?.companies[c.company_id] ?? ""}
          >
            <option value="">{t("Ingen åtkomst", "No access")}</option>
            <option value="read">{t("Läsa", "Read")}</option>
            <option value="read_write">
              {t("Läsa och skriva", "Read and write")}
            </option>
          </select>
        </label>
      ))}
    </fieldset>
  );
}
export function MembersPage({
  companies,
  t,
  sources = false,
}: {
  companies: Company[];
  t: Translate;
  sources?: boolean;
}) {
  const [state, setState] = useState<MembersState | null>(null);
  const [editing, setEditing] = useState<Member | null>(null);
  const [message, setMessage] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const load = useCallback(
    async () => setState(await api<MembersState>("/admin/members/state")),
    [],
  );
  useEffect(() => {
    let live = true;
    void api<MembersState>("/admin/members/state")
      .then((s) => {
        if (live) setState(s);
      })
      .catch(() => {
        if (live)
          setMessage(
            t("Medlemskap kunde inte hämtas.", "Could not load memberships."),
          );
      });
    return () => {
      live = false;
    };
  }, [t]);
  async function action(path: string, body: unknown) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setMessage("");
    setSecret("");
    try {
      const result = await api<{ token?: string; invitation_url?: string }>(
        path,
        body,
      );
      setSecret(result.token ?? result.invitation_url ?? "");
      setEditing(null);
      await load();
      setMessage(t("Uppdaterat.", "Updated."));
      return true;
    } catch {
      setMessage(
        t(
          "Åtgärden kunde inte bekräftas. Läs in aktuell status innan du försöker igen.",
          "The action could not be confirmed. Reload current status before trying again.",
        ),
      );
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void action("/admin/members/save", {
      id: editing?.id ?? null,
      revision: editing?.revision ?? null,
      user: {
        email: editing?.user_id ? editing.email : data.get("email"),
        name: data.get("name"),
        role: data.get("role"),
        active: data.get("active") === "on",
        companies: companyChoices(form),
      },
    }).then((saved) => {
      if (saved) form.reset();
    });
  }
  return (
    <>
      <h1>
        {sources
          ? t("Medlemsintegrationer", "Membership integrations")
          : t("Medlemmar", "Members")}
      </h1>
      <p>
        {t(
          "En källa styr varje medlemskap. En lokal nödspärr gäller alltid. Installationsägaren är skyddad.",
          "Each membership has one managing source. A local emergency block always applies. The installation owner is protected.",
        )}
      </p>
      <Message>{message}</Message>
      {secret && (
        <section className="notice">
          <h2>{t("Privat engångsuppgift", "Private one-time credential")}</h2>
          <p>
            {t(
              "Förmedla säkert. Lägg aldrig uppgiften i AI-klienten. Den visas inte igen efter att du lämnar sidan.",
              "Deliver securely. Never put this credential in the AI client. It will not be shown again after leaving this page.",
            )}
          </p>
          <textarea
            aria-label={t("Privat uppgift", "Private credential")}
            readOnly
            value={secret}
            rows={4}
          />
          <button
            type="button"
            className="secondary"
            onClick={() => setSecret("")}
          >
            {t("Dölj", "Hide")}
          </button>
        </section>
      )}
      {!state ? (
        <p>{t("Hämtar medlemskap…", "Loading memberships…")}</p>
      ) : (
        <fieldset disabled={busy} className="workspace">
          {sources ? (
            <>
              {!state.provisioning && (
                <p className="notice">
                  {t(
                    "Provisionerings-API:t är avstängt. Operatören behöver aktivera det.",
                    "The provisioning API is disabled. The operator must enable it.",
                  )}
                </p>
              )}
              <section className="content-section">
                <h2>{t("Ny integration", "New integration")}</h2>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    void action("/admin/membership-sources/create", {
                      name: data.get("name"),
                      companies: data.getAll("company"),
                      allowAdmins: data.get("allowAdmins") === "on",
                    });
                  }}
                >
                  <Field
                    name="name"
                    label={t("Namn", "Name")}
                    maxLength={120}
                    defaultValue={editing?.name ?? ""}
                  />
                  {companies.map((c) => (
                    <label className="check" key={c.company_id}>
                      <input
                        type="checkbox"
                        name="company"
                        value={c.company_id}
                      />
                      {c.name}
                    </label>
                  ))}
                  {state.role === "owner" && (
                    <label className="check">
                      <input type="checkbox" name="allowAdmins" />
                      {t(
                        "Tillåt tillsättning av administratörer med åtkomst till hela installationen",
                        "Allow provisioning administrators with access to the whole installation",
                      )}
                    </label>
                  )}
                  <button type="submit">
                    {t("Skapa integration", "Create integration")}
                  </button>
                </form>
              </section>
              {state.sources.map((s) => (
                <section className="content-section" key={s.id}>
                  <h2>{s.name}</h2>
                  <p>
                    {s.allowAdmins
                      ? t(
                          "Kan hantera administratörer",
                          "Can manage administrators",
                        )
                      : t("Kan hantera medarbetare", "Can manage members")}{" "}
                    ·{" "}
                    {s.active ? t("Aktiv", "Active") : t("Spärrad", "Revoked")}
                  </p>
                  <code>{s.id}</code>
                  {(!s.allowAdmins || state.role === "owner") && (
                    <div className="actions">
                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          void action("/admin/membership-sources/rotate", {
                            id: s.id,
                            revision: s.revision,
                            active: true,
                          })
                        }
                      >
                        {t("Utfärda ny nyckel", "Issue replacement key")}
                      </button>
                      {s.active && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() =>
                            void action("/admin/membership-sources/rotate", {
                              id: s.id,
                              revision: s.revision,
                              active: false,
                            })
                          }
                        >
                          {t("Återkalla nyckeln", "Revoke key")}
                        </button>
                      )}
                    </div>
                  )}
                </section>
              ))}
            </>
          ) : (
            <>
              <section className="content-section">
                <h2>
                  {editing
                    ? t("Redigera medlemskap", "Edit membership")
                    : t("Ny medlem", "New member")}
                </h2>
                <form
                  key={editing ? `${editing.id}:${editing.revision}` : "new"}
                  onSubmit={save}
                >
                  <Field
                    name="email"
                    type="email"
                    label={t("E-post", "Email")}
                    maxLength={254}
                    defaultValue={editing?.email ?? ""}
                    disabled={!!editing?.user_id}
                  />
                  <Field
                    name="name"
                    label={t("Namn", "Name")}
                    maxLength={120}
                    defaultValue={editing?.name ?? ""}
                  />
                  <label className="field">
                    {t("Roll", "Role")}
                    <select
                      name="role"
                      defaultValue={editing?.role ?? "member"}
                    >
                      <option value="member">
                        {t("Medarbetare", "Member")}
                      </option>
                      <option value="admin">
                        {t("Administratör", "Administrator")}
                      </option>
                    </select>
                  </label>
                  {editing && (
                    <p>
                      {t("Befintlig e-post", "Existing email")}: {editing.email}
                      .{" "}
                      {t(
                        "E-post för aktiverade konton kan inte ändras genom medlemssynkronisering.",
                        "Email for activated accounts cannot be changed through membership provisioning.",
                      )}
                    </p>
                  )}
                  <label className="check">
                    <input
                      name="active"
                      type="checkbox"
                      defaultChecked={editing?.active ?? true}
                    />
                    {t("Aktiv", "Active")}
                  </label>
                  <CompanyAccess companies={companies} member={editing} t={t} />
                  <button type="submit">
                    {t("Spara medlemskap", "Save membership")}
                  </button>
                  {editing && (
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => setEditing(null)}
                    >
                      {t("Avbryt", "Cancel")}
                    </button>
                  )}
                </form>
              </section>
              {state.members.map((m) => (
                <section className="content-section" key={m.id}>
                  <h2>{m.name}</h2>
                  <p>
                    {m.email} ·{" "}
                    {m.role === "admin"
                      ? t("Administratör", "Administrator")
                      : t("Medarbetare", "Member")}{" "}
                    ·{" "}
                    {m.active ? t("Aktiv", "Active") : t("Inaktiv", "Inactive")}
                    {m.blocked
                      ? ` · ${t("Nödspärrad", "Emergency blocked")}`
                      : ""}
                  </p>
                  <p>
                    {t("Styrande källa", "Managing source")}:{" "}
                    {state.sources.find((s) => s.id === m.source)?.name ??
                      m.source}
                  </p>
                  <div className="actions">
                    {m.source === "local" && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setEditing(m)}
                      >
                        {t("Redigera", "Edit")}
                      </button>
                    )}
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        void action("/admin/members/block", {
                          id: m.id,
                          revision: m.revision,
                          blocked: !m.blocked,
                        })
                      }
                    >
                      {m.blocked
                        ? t("Häv nödspärr", "Remove emergency block")
                        : t("Nödspärra", "Emergency block")}
                    </button>
                    {!m.user_id && m.active && !m.blocked && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          void action("/admin/members/invitation", {
                            id: m.id,
                            revision: m.revision,
                          })
                        }
                      >
                        {t("Skapa inbjudningslänk", "Create invitation link")}
                      </button>
                    )}
                  </div>
                  <details>
                    <summary>
                      {t(
                        "Koppla befintligt konto eller byt källa",
                        "Link existing account or change source",
                      )}
                    </summary>
                    <p>
                      {t(
                        "Kopplar endast ett redan skapat konto med exakt samma e-post. Ändringen kräver ett nytt klientgodkännande.",
                        "Links only an existing account with the exact same email. The change requires renewed client consent.",
                      )}
                    </p>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const d = new FormData(event.currentTarget);
                        void action("/admin/members/link", {
                          id: m.id,
                          revision: m.revision,
                          email: m.email,
                          source: d.get("source"),
                          external_id: d.get("external_id"),
                        });
                      }}
                    >
                      <label className="field">
                        {t("Källa", "Source")}
                        <select name="source" defaultValue={m.source}>
                          <option value="local">{t("Lokal", "Local")}</option>
                          {state.sources
                            .filter((s) => s.active)
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label className="field">
                        {t("Externt användar-ID", "External user ID")}
                        <input
                          name="external_id"
                          defaultValue={m.external_id}
                          required
                          pattern="[A-Za-z0-9_-]{1,128}"
                        />
                      </label>
                      <button type="submit">
                        {t("Bekräfta koppling", "Confirm link")}
                      </button>
                    </form>
                  </details>
                </section>
              ))}
            </>
          )}
        </fieldset>
      )}
    </>
  );
}

interface Me {
  email: string;
  role: string;
  mcp_url: string;
  companies: Array<{
    company_id: string;
    name: string;
    access: string;
    read_only: boolean;
    review: string;
  }>;
  clients: Array<{
    registration_key: string;
    client_id: string;
    revision: number;
    current: boolean;
  }>;
  clients_partial: boolean;
}
export function EmployeePage({
  t,
  onLanguage,
}: {
  t: Translate;
  onLanguage: () => void;
}) {
  const [me, setMe] = useState<Me | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    void api<Me>("/api/me")
      .then((v) => {
        if (live) setMe(v);
      })
      .catch(() => {
        if (live)
          setMessage(
            t(
              "Logga in igen för att visa din åtkomst.",
              "Sign in again to view your access.",
            ),
          );
      });
    return () => {
      live = false;
    };
  }, [t]);
  return (
    <div className="consent-page">
      <header className="consent-header">
        <strong>Fortnox MCP</strong>
        <button type="button" className="secondary" onClick={onLanguage}>
          {t("English", "Svenska")}
        </button>
      </header>
      <main className="consent-main">
        <h1>{t("Min åtkomst", "My access")}</h1>
        <Message>{message}</Message>
        {me ? (
          <>
            <p>{me.email}</p>
            {me.role !== "member" && (
              <a href="/admin">{t("Administration", "Administration")}</a>
            )}
            <section className="content-section">
              <h2>{t("Mina företag", "My companies")}</h2>
              {!me.companies.length && (
                <p>
                  {t(
                    "Inga företag har tilldelats dig ännu.",
                    "No companies have been assigned yet.",
                  )}
                </p>
              )}
              {me.companies.map((c) => (
                <article className="grant-row" key={c.company_id}>
                  <h3>{c.name}</h3>
                  <p>
                    {c.access === "read" || c.read_only
                      ? t("Läsa", "Read")
                      : t("Läsa och skriva", "Read and write")}{" "}
                    ·{" "}
                    {c.review === "review_required"
                      ? t(
                          "Granskning krävs för manuell bokföring",
                          "Manual vouchers require review",
                        )
                      : t("Klientstyrd granskning", "Client-managed review")}
                  </p>
                </article>
              ))}
            </section>
            <section className="content-section">
              <h2>{t("Anslut din AI-klient", "Connect your AI client")}</h2>
              <p>
                {t(
                  "Använd adressen nedan i klientens anslutningsinställningar. Logga in med ditt eget konto och godkänn valda företag.",
                  "Use the URL below in your client connection settings. Sign in with your own account and approve the selected companies.",
                )}
              </p>
              <code>{me.mcp_url}</code>
              {me.clients.map((c) => (
                <article key={c.registration_key} className="grant-row">
                  <code>{c.client_id}</code>
                  <p>
                    {c.current
                      ? t("Godkännande registrerat", "Consent recorded")
                      : t("Nytt godkännande krävs", "Renewed consent required")}
                  </p>
                  <button
                    type="button"
                    className="secondary"
                    onClick={async () => {
                      try {
                        await api("/api/me/clients/revoke", {
                          registration_key: c.registration_key,
                          revision: c.revision,
                        });
                        setMe(await api<Me>("/api/me"));
                      } catch {
                        setMessage(
                          t(
                            "Kunde inte bekräfta återkallning. Läs in sidan igen.",
                            "Could not confirm revocation. Reload the page.",
                          ),
                        );
                      }
                    }}
                  >
                    {t("Återkalla", "Revoke")}
                  </button>
                </article>
              ))}
              {me.clients_partial && (
                <p>{t("Listan är ofullständig.", "The list is incomplete.")}</p>
              )}
            </section>
            <section className="content-section">
              <h2>{t("Byt lösenord", "Change password")}</h2>
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const body = Object.fromEntries(new FormData(form));
                  form.reset();
                  try {
                    await api("/api/me/password", body);
                    setMessage(
                      t("Lösenordet har ändrats.", "Password changed."),
                    );
                  } catch {
                    setMessage(
                      t(
                        "Lösenordet kunde inte ändras.",
                        "Could not change password.",
                      ),
                    );
                  }
                }}
              >
                <Field
                  name="currentPassword"
                  type="password"
                  label={t("Nuvarande lösenord", "Current password")}
                />
                <Field
                  name="newPassword"
                  type="password"
                  label={t("Nytt lösenord", "New password")}
                  minLength={12}
                  maxLength={128}
                />
                <button type="submit">
                  {t("Byt lösenord", "Change password")}
                </button>
              </form>
            </section>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                void api("/auth/sign-out", {}).then(() =>
                  location.assign("/sign-in"),
                )
              }
            >
              {t("Logga ut", "Sign out")}
            </button>
          </>
        ) : (
          <a href="/sign-in">{t("Logga in", "Sign in")}</a>
        )}
      </main>
    </div>
  );
}

export function AcceptInvitation({ t }: { t: Translate }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [credentials] = useState(
    () => new URLSearchParams(location.hash.slice(1)),
  );
  useEffect(() => {
    history.replaceState(null, "", location.pathname);
  }, []);
  return (
    <section className="login">
      <h1>{t("Aktivera ditt konto", "Activate your account")}</h1>
      <p>
        {t(
          "Välj ditt eget lösenord. Inbjudningslänken gäller en gång i högst ett dygn.",
          "Choose your own password. The invitation is single-use and valid for at most one day.",
        )}
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          const form = event.currentTarget;
          const password = new FormData(form).get("password");
          form.reset();
          try {
            await api("/api/invitations/accept", {
              id: credentials.get("id"),
              token: credentials.get("token"),
              password,
            });
            location.assign("/app");
          } catch {
            setMessage(
              t(
                "Aktiveringen kunde inte bekräftas. Försök logga in om du redan har ett konto; be annars administratören kontrollera status och skapa en ny inbjudan.",
                "Activation could not be confirmed. Try signing in if you already have an account; otherwise ask the administrator to check status and issue a new invitation.",
              ),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field
          name="password"
          type="password"
          label={t("Lösenord", "Password")}
          minLength={12}
          maxLength={128}
        />
        <button type="submit" disabled={busy}>
          {t("Aktivera konto", "Activate account")}
        </button>
      </form>
      <Message>{message}</Message>
      <a href="/sign-in">{t("Logga in", "Sign in")}</a>
    </section>
  );
}
