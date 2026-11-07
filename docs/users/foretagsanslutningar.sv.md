# Säkra företagsanslutningar

Kvittoprovets nya `inbox connectfile` begärs endast med det uttryckliga testvalet
`FORTNOX_RECEIPT_CONSENT`; se [ENV-guiden](env.sv.md). Det utökar inte gamla
anslutningar. När det faktiska filprovet ska genomföras behövs nytt ägarinitierat
medgivande för respektive tillåtet testföretag och aktuella MCP-behörigheter.
Samma tenant behåller handtaget men får en ny anslutningsgeneration vid
återanslutning. Kontrollera först olösta utfall och följ
[filprovets förutsättningar](../implementation/M04-G06-files.md).

Börja med [ENV-konfigurationen](env.sv.md) för privata värden och startkommandon.

Detta är produktimplementation under verifiering. Använd en separat testinstallation och uttryckligen tillåtna testföretag. Fortnox-operationer är avstängda tills deras klient- och providerevidens är godkänd.

## Ägare och inloggning

Installationsoperatören skapar en privat engångskod med tio minuters giltighet. Öppna `/setup`, ange koden, din e-postadress och ett lösenord på minst tolv tecken. Inga koder, lösenord eller Fortnox-hemligheter ska klistras in i AI-konversationen. Därefter används `/sign-in`; sessionen gäller högst ett dygn. Inloggningen begränsas gemensamt för installationen för att motverka upprepade försök.

Operatören kör `node --import tsx scripts/product-operator.ts .data/operator.json` med privat JSON innehållande `origin`, `secret`, `database`, `output` och `action` (`bootstrap` eller `reset`). Återställning kräver också ägarens `email`. Filen och utdata ska ligga utanför git med privata filrättigheter. Databasens migrationer ska redan vara applicerade. Hemligheter ska inte skickas som kommandoradsargument.

För D1: skapa motsvarande engångskod privat, beräkna SHA-256 och sätt en tio minuters sluttid. Importera en granskad privat SQL-instruktion som endast infogar posten `installation`/`owner` i `product_state` om den inte finns (`ON CONFLICT DO NOTHING`), med version 1 och värdet `{phase:"ready",ownerId:"",tokenHash:<hash>,expiresAt:<UTC-millis>}`. Kontrollera att exakt en post skapades. Återanvänd aldrig en befintlig installations ägare eller hemligheter. Produktionskonton ingår inte i testet.

Om bootstrap avbryts efter att koden förbrukats måste operatören utreda befintligt konto och tillstånd; starta inte om genom att radera ägaren. Glömt lösenord återställs genom en ny privat biblioteksgenererad kod, som gäller i tio minuter. Skicka den med det nya lösenordet till samma origins `/auth/reset-password`; koden kan användas en gång och tidigare adminsessioner återkallas. Ägaridentiteten bevaras. E-postutskick och offentlig registrering ingår inte.

För Worker/D1: operatören förbereder privata `.data/product-recovery.json` med `origin`, den befintliga ägarens `ownerId` från installationens lagring och ägarens `email`. `.env` ska innehålla installationens `AUTH_SECRET`. Kör `npm run prepare:product:recovery`, applicera `.data/product-recovery.sql` en gång på rätt D1-databas och kontrollera att exakt en rad ändrades. Vid noll ändringar ska ägaruppgifterna, databasen och kodens giltighet kontrolleras; ägaren ska inte ersättas.

Öppna sedan `<PUBLIC_ORIGIN>/reset-password` och ange koden från `.data/product-recovery-code.txt` och ett nytt lösenord på minst tolv tecken. Logga in igen efter återställningen. Håll båda utdatafilerna privata och ta bort dem efter användning; återimportera inte gammal återställnings-SQL. Koden, lösenordet och callback-adresser med query-parametrar ska inte läggas i chatten.

## Kryptering och företag

Credentials krypteras med en extern 32-byte-nyckel (base64). Förvara nycklarna separat från databasen och dess backup. Varje nyckel har ett ID; behåll den gamla under en kontrollerad nyckelrotation och verifierad återställning. Saknad eller fel nyckel blockerar åtkomst.

Nyckelkontrollen gäller även privata företagslistor och status, och finns kvar efter frånkoppling när credentials har raderats. Vid flera nyckelversioner måste alla nycklar som fortfarande används finnas kvar. Äldre experimentella anslutningar uppgraderas först när befintliga credentials kan dekrypteras; annars spärras åtkomsten och operatören behöver återställa den korrekta konfigurationen. Radera inte ägaridentiteten eller byt nyckel på chans.

Installationen har högst 20 anslutningar. Företag får opaka stabila handtag; samma Fortnox-tenant kan inte läggas till två gånger. Klientens företagsbehörigheter binds till aktuell anslutningsgeneration. Grundpolicyn är skrivskydd och obligatorisk granskning av framtida manuella verifikationer.

## Anslut AI-klienten

Produktens MCP-adress är `/mcp`. Endast fasta protokolluppgifter är offentliga. Företagsanrop kräver ägarens OAuth-godkännande med `mcp:read offline_access`; Fortnox-token kan inte användas som MCP-token.

Godkännandet gäller de företag och anslutningsgenerationer som fanns vid anslutningen. När ett företag läggs till eller återansluts behöver du i denna version skapa en ny MCP-klientregistrering och godkänna den. Äldre registreringar utökas inte automatiskt. ChatGPT-stödet ska verifieras mot den pushade produktversionen, inklusive sparat svar, konversationsomladdning och Reload tools.

## Begränsningar vid läsning

Anrop begränsas separat för varje integration och företag. Vid tillfälliga fel görs högst tre läsförsök inom en begränsad tidsbudget. Ofullständig sidläsning markeras uttryckligen; en continuation gäller i tio minuter och kan inte användas för ett annat företag. Ett okänt behörighetsfel beskrivs som okänt tills scope, licens eller användarrättighet har verifierats. Providerfel återger inga råa svar eller hemligheter.

## Servicekonto

Registrera installationens egen integration i Fortnox med endast `companyinformation profile`, aktivera servicekonto och S256 PKCE och ange exakt `<PUBLIC_ORIGIN>/admin/fortnox/callback` som redirect. Du anger Client ID och Client Secret privat i installationens konfiguration. Starta consent i den inloggade administrationen och välj ett tillåtet testföretag i Fortnox.

Installationen verifierar företaget via Fortnox innan anslutningen sparas. Servicekontot förnyar sedan access-token med client credentials och verifierad tenant. Den refresh-token som kan följa med första consent sparas inte för servicekontot. Ett Fortnox-servicekonto ger inga administrativa rättigheter till installationen.

## Användaranslutning

Välj användaranslutning när servicekonto inte passar. Fortnox begär offlineåtkomst och installationen sparar refresh-token krypterad. Endast en förnyelse per anslutning får pågå åt gången. Om rotationssvaret försvinner, refresh-token blir ogiltig eller ett avbrutet anrop inte kan bevisas säkert, visas återanslutningsbehov. Gamla refresh-token skickas inte igen på chans.

## Koppla från och återanslut

Frånkoppling stoppar nya anrop och tar bort lagrade credentials. Ett anrop som redan skickats till Fortnox kan inte återtas. Sena tokensvar kan inte återaktivera företaget. Eventuella minimala utredningsuppgifter om okända skrivutfall raderas inte genom frånkoppling.

Ett tidigare behörigt anrop kan få `CONNECTION_DISCONNECTED` direkt efter frånkoppling. Okänt eller obehörigt företag ger `COMPANY_FORBIDDEN`, och ett providerfel som kräver nytt godkännande ger `RECONNECT_REQUIRED`. Inget av felresultaten lämnar en företagsprofil. Andra behöriga företag kan fortfarande läsas.

Återanslutning kräver nytt Fortnox-godkännande och företagskontroll. Samma tenant behåller sitt företagshandtag men får ny behörighetsgeneration; ett annat företag får ett nytt handtag. Skapa därefter en ny MCP-klientregistrering och godkänn den. Äldre grants och framtida granskningsunderlag återfår inte giltighet genom återanslutningen.


## Vad är verifierat?

Den lokala implementationen och dess syntetiska Node-/workerd-tester är separata från verkliga Fortnox- och ChatGPT-prov. #75 gäller anslutning och företagsläsning. Senare referens-, verifikations- och filoperationer verifieras i #92–#94. Inget ärende stängs genom att enbart flytta krav eller slå på en miljövariabel.

## Om anslutningen misslyckas

Kontrollera att Client ID tillhör rätt integration, att `companyinformation` och `profile` är valda i Fortnox utvecklarportal och att redirect URI är exakt installationens `/admin/fortnox/callback`. Fortnox beskriver `invalid_scope` i sin [felsökningsguide](https://www.fortnox.se/developer/faq); de giltiga namnen finns i [scope-listan](https://www.fortnox.se/developer/guides-and-good-to-know/scopes).

Produktens felresultat kan innehålla `stage`, `reason`, `provider_error` och `provider_status`. De anger ett begränsat felsteg och redigerade felkoder, utan tokens eller providersvar. Återge detta JSON-resultat vid felsökning. Kopiera inte callback-adressen eller dess query-parametrar: där kan det finnas en engångskod och state.

Starta alltid ett nytt försök från administrationen efter en korrigering. En förbrukad kod eller förnyelsetoken skickas inte igen på chans. Ett generiskt eller okänt fel ska inte tolkas som bevis för saknad licens eller behörighet.
