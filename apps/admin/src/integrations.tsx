import type { InstallationGrant } from "@fortnox-mcp/core";
import { useEffect, useState } from "react";
import { api } from "./api.js";
import type { Translate } from "./forms.js";

interface AccessState {
  enabled: boolean;
  available: boolean;
  integrations: InstallationGrant[];
  offline_client_ids: string[];
  companies: {
    company_id: string;
    name: string;
    mode: string;
    state: string;
    missing_features: string[];
    missing_scopes: string[];
    read_only: boolean;
    manual_vouchers: string;
  }[];
}
export function IntegrationsPage({ t }: { t: Translate }) {
  const [state, setState] = useState<AccessState>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [onboarding, setOnboarding] = useState("");
  const [writes, setWrites] = useState(false);
  const [secret, setSecret] = useState<{
    client_id: string;
    client_secret: string;
  }>();
  useEffect(() => {
    let active = true;
    void api<AccessState>("/admin/integrations/data")
      .then((value) => {
        if (active) setState(value);
      })
      .catch(() => {
        if (active)
          setError(
            t(
              "Installationsägaren behöver logga in för att hantera serveråtkomst.",
              "The installation owner must sign in to manage backend access.",
            ),
          );
      });
    return () => {
      active = false;
    };
  }, [t]);
  async function perform(body: unknown) {
    if (busy) return;
    setBusy(true);
    setError("");
    setSecret(undefined);
    try {
      const result = await api<{ client_id?: string; client_secret?: string }>(
        "/admin/integrations/data",
        body,
      );
      if (result.client_id && result.client_secret)
        setSecret({
          client_id: result.client_id,
          client_secret: result.client_secret,
        });
      setState(await api<AccessState>("/admin/integrations/data"));
      setWrites(false);
    } catch {
      setError(
        t(
          "Åtgärden kunde inte bekräftas. Ladda om och kontrollera sparat läge innan du försöker igen. En förlorad klienthemlighet kan ersättas med rotation.",
          "The action could not be confirmed. Reload and check saved state before retrying. Rotate a lost client secret.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h1>{t("Serverintegrationer", "Backend integrations")}</h1>
      <p className="intro">
        {t(
          "Godkänn en applikations åtkomst till nuvarande och framtida anslutna företag. Åtkomsten fortsätter efter utloggning, omstart och personalbyte tills du återkallar den.",
          "Approve application access to current and future connected companies. Access survives logout, restart and staff changes until revoked.",
        )}
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {secret ? (
        <section
          className="content-section"
          aria-label={t("Nya serveruppgifter", "New backend credentials")}
        >
          <h2>{t("Spara uppgifterna nu", "Save these credentials now")}</h2>
          <p>
            {t(
              "Hemligheten visas bara här efter denna åtgärd. Förvara den i applikationens hemlighetslager.",
              "The secret is shown only after this action. Store it in the application's secret store.",
            )}
          </p>
          <label>
            Client ID
            <input readOnly value={secret.client_id} />
          </label>
          <label>
            Client secret
            <input
              readOnly
              type="password"
              autoComplete="off"
              value={secret.client_secret}
            />
          </label>
          <button
            type="button"
            className="secondary"
            onClick={() => setSecret(undefined)}
          >
            {t("Jag har sparat uppgifterna", "I have saved the credentials")}
          </button>
        </section>
      ) : null}
      {state ? (
        <>
          <section className="content-section">
            <h2>
              {t(
                "Godkänn en serverintegration",
                "Approve a backend integration",
              )}
            </h2>
            {!state.enabled || !state.available ? (
              <p>
                {t(
                  "Operatören behöver aktivera installationsåtkomst, REST och REST-bryggan först.",
                  "The operator must first enable installation access, REST and the REST bridge.",
                )}
              </p>
            ) : null}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void perform({
                  action: "create",
                  name,
                  allow_writes: writes,
                  ...(onboarding.trim()
                    ? { onboarding_client_id: onboarding.trim() }
                    : {}),
                });
              }}
            >
              <fieldset disabled={busy || !state.enabled || !state.available}>
                <label>
                  {t("Applikationens namn", "Application name")}
                  <input
                    required
                    maxLength={128}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label>
                  {t(
                    "Befintligt klient-ID för kundanslutning (valfritt)",
                    "Existing company onboarding client ID (optional)",
                  )}
                  <input
                    maxLength={256}
                    value={onboarding}
                    onChange={(e) => setOnboarding(e.target.value)}
                  />
                </label>
                <p>
                  {t(
                    "Ekonomiprofil: bokföring, konton, referenser samt kund- och leverantörsfakturor. Befintliga kundmedgivanden och företagsregler begränsar alltid åtkomsten. Lön och filer ingår inte.",
                    "Finance profile: bookkeeping, accounts, references, customer and supplier invoices. Existing customer consent and company rules always limit access. Payroll and files are excluded.",
                  )}
                </p>
                <label>
                  <input
                    type="checkbox"
                    checked={writes}
                    onChange={(e) => setWrites(e.target.checked)}
                  />
                  {t(
                    "Godkänn även skrivning inom ekonomiprofilen för nuvarande och framtida företag",
                    "Also approve finance-profile writes for current and future companies",
                  )}
                </label>
                <p>
                  {t(
                    "Företagets skrivskydd och krav på granskning av manuella verifikationer gäller även med aktiverad skrivning.",
                    "Company read-only settings and manual voucher review requirements still apply when writes are enabled.",
                  )}
                </p>
                <button type="submit">
                  {t("Godkänn beständig åtkomst", "Approve persistent access")}
                </button>
              </fieldset>
            </form>
          </section>
          <section className="content-section">
            <h2>{t("Godkända integrationer", "Approved integrations")}</h2>
            {state.integrations.map((g) => (
              <article key={g.id}>
                <h3>{g.name}</h3>
                <p>
                  {g.active
                    ? g.writes
                      ? t("Läsning och skrivning", "Read and write")
                      : t("Läsning", "Read")
                    : t("Återkallad", "Revoked")}
                </p>
                <p>
                  Client ID: <code>{g.clientId}</code>
                </p>
                <fieldset disabled={busy}>
                  <button
                    type="button"
                    className="secondary"
                    disabled={!state.enabled || !state.available}
                    onClick={() =>
                      void perform({
                        action: "rotate",
                        id: g.id,
                        expected_revision: g.revision,
                      })
                    }
                  >
                    {t(
                      "Rotera hemlighet och aktivera",
                      "Rotate secret and activate",
                    )}
                  </button>
                  {g.active ? (
                    <>
                      <button
                        type="button"
                        className="secondary"
                        disabled={!state.enabled || !state.available}
                        onClick={() =>
                          void perform({
                            action: "change",
                            id: g.id,
                            expected_revision: g.revision,
                            allow_writes: !g.writes,
                          })
                        }
                      >
                        {g.writes
                          ? t("Återkalla skrivning", "Revoke writes")
                          : t(
                              "Godkänn skrivning för nuvarande och framtida företag",
                              "Approve writes for current and future companies",
                            )}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          void perform({
                            action: "revoke",
                            id: g.id,
                            expected_revision: g.revision,
                          })
                        }
                      >
                        {t("Återkalla all åtkomst", "Revoke all access")}
                      </button>
                    </>
                  ) : null}
                </fieldset>
              </article>
            ))}
          </section>
          <section className="content-section">
            <h2>
              {t("Befintliga kundanslutningar", "Existing company connections")}
            </h2>
            <p>
              {t(
                "Detta är sparad konfiguration, inte ett bevis på aktuell läsbarhet. Office behöver kontrollera faktisk ekonomiläsning.",
                "This is stored configuration, not evidence of current readability. Office must check actual financial reads.",
              )}
            </p>
            {state.companies.map((c) => (
              <p key={c.company_id}>
                <strong>{c.name}</strong>: {c.mode}, {c.state}.{" "}
                {c.missing_scopes.length
                  ? `${t("Saknas", "Missing")}: ${c.missing_scopes.join(", ")}`
                  : t(
                      "Profilens behörigheter finns.",
                      "Profile scopes are present.",
                    )}{" "}
                {c.missing_features.length
                  ? `${t("Programval saknas", "Missing feature selection")}: ${c.missing_features.join(", ")}. `
                  : ""}
                {c.read_only ? t("Skrivskyddat.", "Read-only.") : ""}
              </p>
            ))}
            <p>
              {t(
                "Klienter med 30 dagars förnyelsepolicy",
                "Clients with 30-day refresh policy",
              )}
              : {state.offline_client_ids.join(", ") || "—"}
            </p>
          </section>
        </>
      ) : !error ? (
        <p>{t("Hämtar serveråtkomst…", "Loading backend access…")}</p>
      ) : null}
    </>
  );
}
