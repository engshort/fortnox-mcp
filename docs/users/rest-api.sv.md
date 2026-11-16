# Anslut en annan applikation

Fortnox MCP har ett valbart REST-API för applikationer som behöver läsa data med
vanliga HTTP-anrop. MCP använder samma bakomliggande tjänster. API:t är avstängt
från början och innebär inte verifierat produktionsstöd för nya operationer.

Installationsansvarig sätter `REST_API_ENABLED=true` och lägger applikationens
exakta HTTPS-callback i `MCP_REDIRECT_URIS`. Det befintliga inställningsnamnet
används för både MCP- och REST-klienter. Utvecklaren följer den
[engelska integrationsguiden](../rest-api.md).

Du loggar in på din egen installation, granskar applikationens begärda åtkomst
och väljer uttryckligen vilka företag den får läsa. Nya företag läggs inte till
automatiskt; ändrat urval kräver ny klientregistrering och nytt medgivande.
Applikationen får egna token, aldrig dina Fortnox-token eller installationshemligheter.
Ägarinloggning, Fortnox-anslutning och applikationsmedgivande är separata.

Grundbehörigheten ger företagslista, anslutningsstatus och tillgängliga
referensläsningar. Ekonomiläsning kräver separat medgivande och aktiverade moduler.
Den omfattar kund- och leverantörsfakturor, verifikationer och konton med Fortnox
rapporterade ingående/utgående årssaldon. Den ger ingen rätt att skapa, ändra,
skicka eller bokföra något. Befintliga MCP-klienter behöver också nytt medgivande
för dessa nya ekonomiläsningar.

För uttryckligen tillåtna tester kan installationsansvarig ange
`FINANCIAL_READ_MODULES=customer_invoices,supplier_invoices,vouchers,accounts`.
Det kräver `FORTNOX_TEST_MODE=true` och de två konfigurerade testföretagen.
Lämna värdet tomt annars. Nya Fortnox-scopes kräver ny anslutning och nytt
provider-medgivande. Inställningen godkänner inga produktionsoperationer.

Välj ett räkenskapsår som servern faktiskt returnerar. Årssaldon är inte
beräknade saldon för valfria datum. Saknade belopp eller okänd valuta förblir
saknade uppgifter. Betalningsstatus är Fortnox status vid hämtningen.

Stora listor hämtas i sidor. Applikationen måste fortsätta så länge svaret
innehåller en fortsättningsreferens och får inte kalla en ofullständig lista för
hela bokföringen. Referensen gäller i tio minuter. API-token måste också förnyas;
refresh har begränsad livslängd och kan kräva ny inloggning. Återkallat medgivande
eller frånkopplat företag stoppar läsning.

Se [aktuell täckning och kvarvarande verifiering](../implementation/REST-read-api.md).
C-bibliotek, kommandoradsverktyg, filer och nya skrivfunktioner ingår inte.
