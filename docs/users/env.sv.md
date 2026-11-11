# Konfiguration för produktens testinstallation

Aktuellt från 11 november 2026: test- och aktiveringsspärrarna är borttagna
i den vanliga installationen. [Funktioner och åtkomst](funktioner.sv.md)
beskriver nuvarande beteende och kvarvarande tekniska förutsättningar. Äldre
testprotokoll nedan beskriver tidigare versioner.

Den privata filen är `.env` i repots rot. Den ignoreras av Git. En förberedd lokal fil har privata filrättigheter och genererade auth-/krypteringshemligheter; `.env.example` är mallen utan hemligheter. Läs inte upp filens innehåll i AI-chatten och ta inte med den i PR eller backup utan motsvarande skydd.

| Variabel | Innehåll |
| --- | --- |
| `PRODUCT_ENABLED` | Äldre inställning som inte längre styr produktens aktivering. |
| `PUBLIC_ORIGIN` | Exakt origin utan avslutande snedstreck. Lokalt `http://127.0.0.1:8787`; för ChatGPT behövs en nåbar HTTPS-origin i den separata testinstallationen. |
| `PORT` | Lokal Node-port, normalt `8787`. Node binder endast loopback. |
| `PRODUCT_DATABASE` | Privat SQLite-sökväg, normalt `.data/product.sqlite`. Cloudflare använder i stället sin separata `DB`-binding. |
| `AUTH_SECRET` | Genererad privat sessions-/OAuth-hemlighet, minst 32 tecken. Återanvänd inte probens hemlighet. |
| `CREDENTIAL_ACTIVE_KEY` | ID för nyckeln som krypterar nya credentials, normalt `v1`. |
| `CREDENTIAL_KEYS` | JSON-objekt med nyckel-ID och privata 32-byte-nycklar i vanlig base64. Behåll gamla nycklar under verifierad rotation. |
| `MCP_REDIRECT_URIS` | JSON-lista över exakt tillåtna HTTPS-callbacks för AI-klienten. Mallen innehåller probens observerade ChatGPT-callback; kontrollera att den gäller avsett klientkonto. |
| `FORTNOX_TEST_MODE` | Behövs bara i isolerade acceptansbyggen; påverkar inte vanliga produktbygget. |
| `FORTNOX_CLIENT_ID` | Client ID från installationens egen opublicerade Fortnox-testintegration. |
| `FORTNOX_CLIENT_SECRET` | Samma integrations Client Secret. Ange endast privat här eller som Worker-secret. |
| `FORTNOX_TEST_TENANTS` | Används bara av isolerade acceptansbyggen. Vanliga anslutningar verifierar företagets identitet efter ägarens Fortnox-medgivande. |

## Första lokala starten

Använd repots låsta Node/npm-versioner. Kör `npm ci --ignore-scripts`. Fyll i de privata värdena och kör `npm run dev:product`. Inga aktiveringsflaggor behövs. Spara API-uppgifterna och anslut företagen i administrationen.

Servern applicerar additiva migrationer och skapar den första ägarens engångskod privat i `.data/bootstrap-code.txt`. Öppna `<PUBLIC_ORIGIN>/setup` inom tio minuter, läs koden lokalt och välj e-post/lösenord. Efter bootstrap används `/sign-in` och `/admin`. Koden återöppnas inte av omstart. Om koden hunnit gå ut, använd operatörskommandot enligt [företagsguiden](foretagsanslutningar.sv.md); radera inte databasen för att återställa en befintlig ägare.

## Fortnox och hosted test

Registrera exakt `<PUBLIC_ORIGIN>/admin/fortnox/callback` i Fortnox. Aktivera
servicekonto och S256 PKCE. Första anslutningen begär `companyinformation profile`.
Starta service- eller användarconsent i administrationen. Företaget verifieras
via autentiserat providersvar före lagring. Välj sedan program och ge nytt
medgivande för deras behörigheter. Ingen testlägesflagga behövs.

För Worker/D1 används den separata konfigurationen `apps/worker/wrangler.product.jsonc`, en ny testdatabas och samma migrationer. Den befintliga publika installations-/S00-proben ska inte återanvändas. `.env` laddas inte automatiskt upp till Cloudflare: lägg hemligheterna i Worker-secrets och övriga värden i den privata deploymentkonfigurationen. En lokal Worker kan använda ignorerad `.dev.vars`; kopiera endast nödvändiga variabler privat. Förväxla inte SQLite-sökvägen med D1-bindingen.

Implementerade providerfunktioner finns i den vanliga distributionen. Aktivering
utgör inget generellt produktionsgodkännande eller bevis på genomförd faktisk
klient-/providerverifiering. Företagets åtkomst och policy gäller fortfarande.


För en ny D1-installation kan `npm run prepare:product:bootstrap` skapa en privat kod och `.data/product-bootstrap.sql`. Applicera SQL endast på vald testdatabas och kontrollera att exakt en rad ändrades. SQL kan förnya en ännu oanvänd bootstrap, men ersätter aldrig en aktiv eller redan påbörjad ägare. Koden gäller i tio minuter. Samma villkorade SQL kan användas lokalt om en första oanvänd kod har löpt ut.

Efter den privata klient-/providerkörningen: `npm run test:integration` använder `.data/acceptance.json` och kräver `FORTNOX_ACCEPTANCE_CONFIRM=test-companies-only`. `npm run test:clients` kontrollerar en manuellt upprättad klient-evidensfil, vald med `ACCEPTANCE_CONFIG`. Det senare kommandot genomför inga ChatGPT-klick och får inte användas som bevis för osedda klientresultat.

Installationsstyrd lösenordsåterställning i Worker/D1 använder `npm run prepare:product:recovery`, privat ägarkonfiguration och formuläret `/reset-password`. Se [företagsguiden](foretagsanslutningar.sv.md#ägare-och-inloggning). Detta utfärdar ingen ny ägaridentitet och använder inga Fortnox-hemligheter.

## Förberedd separat testinstallation · 2026-11-06

Den separata [produkt-testinstallationen](https://fortnox-mcp-product-test.alexander-c06.workers.dev/setup) är nu upplagd i valt Cloudflare-konto. Den använder egen Worker/D1 och privata secrets från konfigurationen. Den lokala `.env` har kvar sin lokala origin och sina avstängda standardflaggor.

Nästa manuella steg är att etablera ägaren på `/setup`, ansluta de tillåtna testföretagen på `/admin` och prova klienten. Bootstrapkoden finns endast lokalt i `.data/product-bootstrap-code.txt`, gäller i tio minuter och kan förnyas med kommandot ovan medan bootstrap fortfarande är oanvänd. Du behöver inte använda en utgången kod eller radera databasen.

Fortnox-integrationens exakta callback ska vara `https://fortnox-mcp-product-test.alexander-c06.workers.dev/admin/fortnox/callback`. Klientens MCP-adress är `https://fortnox-mcp-product-test.alexander-c06.workers.dev/mcp`. Efter att företag lagts till eller återanslutits kräver denna version en ny MCP-registrering och ett nytt godkännande. Den förberedda installationen innebär inte att dessa manuella prov redan är godkända.


## Förbered filtransport för kvittoprovet

Välj kvittofiler under företagets program för att begära `inbox connectfile`
genom ett nytt ägarinitierat Fortnox-medgivande. Inga aktiveringsflaggor behövs.
Befintliga anslutningar eller MCP-medgivanden utökas inte automatiskt.

`RECEIPT_FILE_TRANSPORT=none` är runtime-standard; mallen väljer `node-direct`.
`node-direct` använder den lokala
Node-serverns DNS-låsta hämtning; Worker kan endast använda ett uttryckligen valt,
tillfälligt `node-relay`. Filverktygen är aktiverade; transportinställningarna
anger hur filernas original kan hämtas säkert.

- `RECEIPT_FILE_ORIGINS`: exakt observerade och granskade HTTPS-källor, kommaseparerade,
  högst fyra. Inga jokertecken, lokala adresser eller gissade källor.
- `RECEIPT_FILE_RELAY_ORIGIN`: reläets exakta tillfälliga HTTPS-root hos
  `trycloudflare.com`, utan sökväg eller frågeparametrar.
- `RECEIPT_FILE_RELAY_TOKEN`: ett separat 64-teckens hexvärde. På Worker är det en
  secret. Återanvänd inte ägarens, OAuths eller krypteringens hemligheter.
- `RECEIPT_FILE_RELAY_UNTIL`: samma UTC-sluttid som reläet, högst 15 minuter framåt.

När klientprovet ska börja skapar `npm run prepare:receipt-relay` den privata filen
`.data/product-file-relay.json` från de granskade lokala källorna. Befintlig fil
skrivs inte över. `npm run dev:receipt-relay` startar bara den tillfälliga hjälpen
på loopback:8796 och stänger den när tiden går ut. Den laddar inga Fortnox- eller
OAuth-uppgifter. Tolv hämtningar tillåts per session; felaktiga försök kan förbruka
en hämtning. En ny reläsession ändrar aldrig ett sparat bokföringsutfall.

Se [operatörens teststeg](../implementation/M04-receipts-evidence.md#operator-preparation-requires-the-later-human-test-session)
för tunnel, privat Worker-konfiguration och avveckling. Efter provet stängs filinput
av, transporten återställs till `none` och testets relähemlighet tas bort. Denna
förberedelse är inte ett godkänt liveprov eller stöd för direkt Worker-hämtning.
