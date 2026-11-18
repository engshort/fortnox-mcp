import type { Connection, OnboardingAttempt } from "@fortnox-mcp/core";
import { connectionPage, escapeHtml as esc } from "./connection-page.js";

const companyIcon = `<span class="onboarding-company-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4h14v17M3 21h18M9 8h1m4 0h1M9 12h1m4 0h1M10 21v-5h4v5"/></svg></span>`;

export function onboardingPage(
  a: OnboardingAttempt,
  companies: Connection[],
  profile?: string,
) {
  const path = `/connect/company/${a.id}`;
  const hidden = `<input type="hidden" name="revision" value="${a.revision}">`;
  const canChoose = [
    "pending_owner",
    "failed",
    "provider_outcome_unknown",
  ].includes(a.phase);
  const choices = companies
    .map(
      (c) => `<form class="onboarding-company" data-action="${path}/choose">
        ${hidden}<input type="hidden" name="company_id" value="${esc(c.id)}">
        ${companyIcon}<span class="onboarding-company-name"><strong>${esc(c.name)}</strong><small>${esc(c.organizationNumber)}</small></span>
        <button class="secondary" aria-label="Välj ${esc(c.name)}">${profile ? "Välj och använd ekonomiprofilen" : "Välj"}<span aria-hidden="true"> →</span></button>
      </form>`,
    )
    .join("");
  const selected = companies.find((c) => c.id === a.company?.id);
  const start =
    !a.company && ["pending_owner", "failed"].includes(a.phase)
      ? `<section class="onboarding-new" aria-labelledby="new-heading">
          <h2 id="new-heading">Anslut ett nytt företag</h2>
          <p class="muted">Fortsätt till Fortnox för att ansluta företaget och verifiera företagsuppgifterna.</p>
          <form class="onboarding-provider" data-action="${path}/provider">${hidden}
            <label for="connection-mode">Anslutningstyp</label>
            <select id="connection-mode" name="mode"><option value="service">Servicekonto</option>${profile ? "" : '<option value="user">Användare</option>'}</select>
            <button>Fortsätt till Fortnox</button>
          </form>
        </section>`
      : "";
  const approve =
    a.company && ["company_verified", "approval_pending"].includes(a.phase)
      ? `<form data-action="${path}/approve">${hidden}<button>Fortsätt till appgodkännande</button></form>`
      : "";
  const pending =
    a.phase === "provider_pending"
      ? `<section class="notice" aria-labelledby="pending-heading"><h2 id="pending-heading">Fortnox-godkännande pågår</h2><p>Slutför medgivandet i Fortnox. Skicka inte koden igen.</p><form data-action="${path}/cancel-provider">${hidden}<button class="secondary">Avbryt oanvänt medgivande</button></form></section>`
      : "";
  const unknown =
    a.phase === "provider_outcome_unknown"
      ? `<section class="notice" aria-labelledby="unknown-heading"><h2 id="unknown-heading">Utfallet behöver kontrolleras</h2><p>Utfallet av Fortnox-utbytet är okänt. Ingen kod skickas igen. Om företaget redan finns kan du uttryckligen välja och verifiera den befintliga anslutningen nedan. Annars behöver installationsägaren utreda utfallet.</p></section>`
      : "";
  const failed =
    a.phase === "failed"
      ? `<div class="notice"><p>Anslutningen kunde inte slutföras. Välj ett befintligt företag eller starta en ny anslutning om det alternativet visas nedan.</p></div>`
      : "";
  const authorized =
    a.phase === "authorized"
      ? `<div class="consent-access"><h2>Appgodkännandet är genomfört</h2><p>Återgå till applikationen för att kontrollera anslutningsresultatet. Den här sidan skickar inte godkännandet igen.</p></div>`
      : "";
  const cancel = ![
    "provider_pending",
    "provider_outcome_unknown",
    "authorized",
  ].includes(a.phase)
    ? `<form data-action="${path}/cancel">${hidden}<button class="secondary">Avbryt och återgå till applikationen</button></form>`
    : "";
  return connectionPage({
    title: "Anslut företag",
    script: "/connect/company.js",
    content: `<div class="consent-heading"><h1>Anslut företag</h1><p class="intro muted">Välj företag och godkänn sedan applikationens åtkomst.</p></div>
      <div class="onboarding-context"><p>Applikation: <strong>${esc(a.clientName)}</strong></p><p class="muted">Ingen företagspolicy ändras. Att ansluta ett företag ger inte i sig applikationen åtkomst.</p></div>
      ${profile ? '<section class="notice"><h2>Ekonomiprofil för byrån</h2><p>Servicekonto med bokföring, konton, referenser samt kund- och leverantörsfakturor. Befintliga anslutningar återanvänds. Saknade behörigheter begärs i Fortnox. Valet aktiverar profilens programfunktioner; byråns skrivåtkomst godkänns separat. Lön och filer ingår inte.</p></section>' : ""}
      ${pending}${unknown}${failed}${authorized}
      ${start}
      ${
        canChoose
          ? `<section aria-labelledby="companies-heading"><h2 id="companies-heading">${a.company ? "Valt företag" : "Välj ett befintligt företag"}</h2><p class="muted">${a.company ? "Kontrollera företaget innan du fortsätter till appgodkännandet." : "Återanvänd en anslutning som redan finns i installationen."}</p><div class="onboarding-companies">${choices || `<p class="onboarding-empty muted">Inga befintliga företag finns att välja för detta försök.</p>`}</div></section>`
          : selected
            ? `<section aria-labelledby="selected-heading"><h2 id="selected-heading">Valt företag</h2><div class="onboarding-company">${companyIcon}<span class="onboarding-company-name"><strong>${esc(selected.name)}</strong><small>${esc(selected.organizationNumber)}</small></span></div></section>`
            : ""
      }
      <footer class="consent-actions">${approve}${cancel}<p id="status" class="status" role="status" tabindex="-1"></p></footer>`,
  });
}

export function onboardingReturnPage(a: OnboardingAttempt) {
  return connectionPage({
    title: "Anslutningsförsöket har gått ut",
    script: "/connect/company.js",
    content: `<div class="consent-heading"><h1>Anslutningsförsöket har gått ut</h1><p class="intro muted">Fortsätt i applikationen för att få en ny godkännandelänk.</p></div>
      <section class="notice"><p>Dina sparade steg och det verifierade företaget bevaras medan försöket finns kvar. Återinloggning ger inte applikationen åtkomst. Du behöver granska och godkänna åtkomsten igen.</p></section>
      <footer class="consent-actions"><form data-action="/connect/company/${a.id}/return"><input type="hidden" name="revision" value="${a.revision}"><button>Fortsätt i ${esc(a.clientName)}</button></form><p id="status" class="status" role="status" tabindex="-1"></p></footer>`,
  });
}

export function onboardingRecoveryPage(a: OnboardingAttempt, waiting = false) {
  return connectionPage({
    title: "Återuppta ägargranskning",
    script: "/connect/company.js",
    content: `<div class="consent-heading"><h1>Återuppta ägargranskning</h1><p class="intro muted">Logga in och fortsätt kontrollera det sparade utfallet.</p></div>
      <section class="consent-access"><h2>${waiting ? "Fortnox-godkännande pågår" : "Kontrollera anslutningen"}</h2><p>${waiting ? "Vänta tills det pågående utbytet är klart och ladda sedan om sidan." : "Ägarsessionen eller anslutningslänken har gått ut. Kontrollera det sparade utfallet."} Ingen Fortnox-kod skickas igen.</p></section>
      <footer class="consent-actions">${waiting ? '<a href="" class="secondary">Kontrollera sparat läge</a>' : `<form data-action="/connect/company/${a.id}/recover-session"><input type="hidden" name="revision" value="${a.revision}"><button>Fortsätt granska med denna ägarsession</button></form>`}<p id="status" class="status" role="status" tabindex="-1"></p></footer>`,
  });
}
