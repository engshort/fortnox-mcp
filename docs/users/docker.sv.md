# Docker-installation och drift

Nova-installationen kan uppdateras automatiskt efter merge till `main` med publik
HTTPS och en begränsad SSH-deploynyckel, utan Cloudflare Tunnel. Deploy verifierar
kodrevision, hälsa och inloggningsskydd och behåller databas och nycklar.
Se [driftguiden](../deployment-nova.md). Grön deploy aktiverar inga nya Fortnox-funktioner.

Ägaren godkände den levererade MVP:n och publicering efter grön CI den 9 november
2026. Publiceringen gäller en GitHub-prerelease med källkod och Docker-bygge lokalt.
Se [acceptansbeslutet](../implementation/M05-release-authorization-2026-11-09.md).
De tekniska prov som återstår beskrivs nedan; funktionsspärrarna behålls.

Milstolpe 5 byggs för Linux med Docker Compose bakom en befintlig Nginx.
Slutlig klient-/Fortnox-acceptans återstår; använd inga produktionskonton.
Det syntetiska Docker-/HTTPS-provet med omstart, backup och återställning klarades
på den valda Linuxservern den 8 november 2026. Provet använde en separat Nginx och
ett testcertifikat. Den beständiga testinstallationen har också klarat publik TLS,
hälsa, setup och proxykontroller via serverns befintliga Nginx. Ägaren har loggat
in, sparat Fortnox-uppgifter och anslutit två testföretag. Ägaren har rapporterat
lyckad företagslista, anslutningsdiagnos och företagsprofil för båda i en separat
ChatGPT-chatt. En läskontroll på servern bekräftar skilda Fortnox-databas-ID:n och
separata krypterade anslutningsposter. Ägaren har också bekräftat att åtkomst till
ett företag utanför klientsamtycket nekades utan att företagsinformation visades.
Det gemensamma organisationsnumret är
väntat för dessa sandlådor enligt ägarens bekräftelse; det används inte som
tenant-ID. Fullständig acceptans i ChatGPT och Fortnox återstår; se
[testresultatet](../implementation/M05-delivery.md#owner-selected-linux-host-2026-11-08).

Ett senare prov i lokal Chrome visar läsning före och efter klientens frånkoppling
och återanslutning, bevarat chatsvar efter omladdning samt fortsatt läsning efter
tokenens fem minuter. Serverns metadata bekräftar återkallad refresh-token och
tokenrotation efter utgångstiden. Nekad återanvändning av gamla token och övriga
kvitto-/återhämtningsprov återstår; se [klientprovet](../implementation/M05-client-lifecycle-2026-11-08.md).

Fortnox-förnyelse har därefter provats för båda testanslutningarna: service fick
en ny åtkomsttoken och user fick ny åtkomsttoken samt roterad refresh-token.
Ersättningarna kunde läsas tillbaka och företagsprofilerna hämtas efteråt, även
i det efterföljande Chrome-provet. Företagskopplingar och spärrar behölls.
[Gamla-token-proven](../implementation/M05-token-renewal-2026-11-08.md) använder
isolerade syntetiska klienter. Alla fyra negativa fall klarades, inklusive naturlig
utgång efter 307 sekunder. ChatGPTs originaltoken finns inte sparade för återspelning.

## Gemensam Node-applikation

Applikationen använder samma kod och SQLite oavsett processhantering.
`HOST` är normalt `127.0.0.1`, `PORT` är `8787` och `DATA_DIR` är `.data`.
Ett uttryckligt `PRODUCT_DATABASE` överstyr databasens standardsökväg.
Behåll krypteringsnycklarna när du startar om eller uppgraderar.

Node kan läsa `AUTH_SECRET_FILE`, `CREDENTIAL_KEYS_FILE` och
`FORTNOX_CLIENT_SECRET_FILE` från privata filer. Ange inte samtidigt värdet
direkt och med `_FILE`. Inga hemligheter ska byggas in i ett image eller skickas
till ChatGPT. Engångskoden för första ägaren ligger i den privata datakatalogen.

`NODE_PROXY_MODE=nginx` kräver HTTPS, exakt publik värdadress och en Nginx som
skriver över proxyheaders. Exponera inte Node-porten direkt på Internet.
Läget `none` är standard för lokal utveckling.

## Installation

Du behöver en Linuxserver (amd64), Docker Compose, en domän och befintlig Nginx
med HTTPS-certifikat. Bygg imaget från en granskad Git-version enligt
[installationskommandona](../deployment-linux.md#installation). Initieringen skapar
egna nycklar i `deploy/docker/.private`; katalogen ska ha behörighet 0700 och
får inte skickas till Git eller support. Compose monterar nycklarna skrivskyddat.

Anpassa Nginx-exemplet till din domän och kontrollera det med `nginx -t` innan
du använder serverns vanliga rutin för omladdning. Node-porten publiceras bara
på 127.0.0.1:3000. Öppna därefter `/setup` på din HTTPS-adress.

Hämta engångskoden privat med `docker compose cp` från containerns
`/data/bootstrap-code.txt`. Öppna filen lokalt och ta bort kopian efter användning.
Koden gäller i tio minuter och ska aldrig klistras in i AI-konversationen.

Volymen innehåller beständig SQLite-data. Behåll både volym och nycklar vid
uppgradering. Kör inte `down --volumes` på en installation du vill behålla.
Se [leveransstatus](../implementation/M05-delivery.md) för vad som faktiskt testats.

## Kommande installationssätt

Steg 3 blir direkt Node-installation med systemd: samma applikation, men en
installerare måste hantera Node, systemanvändare, rättigheter och uppdateringar.
Steg 4 blir APT med .deb-paket och ett signerat paketarkiv. Dessa steg dokumenteras
nu och är inte implementerade eller tillgängliga installationsalternativ.

## Skyddad setup

Öppna `/setup`, hämta engångskoden privat från datavolymen och skapa ägaren.
Dela aldrig koden eller lösenordet med ChatGPT. Logga därefter in via `/sign-in`.
Under **Fortnox** sparar du egna Client ID/Secret. Formuläret lämnar aldrig
ut sparade värden. Operatörsstyrda ENV-uppgifter ändras i serverkonfigurationen.
Registrera den visade callback-adressen i din egen Fortnox-integration.
Operatören måste först ange exakt två auktoriserade testföretag; produktionskonton
ingår inte. Välj servicekonto eller användaranslutning och ge samtycke i Fortnox.

Under **Företag** kan du granska status, välja skrivskydd och granskningspolicy,
koppla från eller återansluta. En policyändring aktiverar ingen funktion och
godkänner ingen verifikation. I denna version kräver nya eller återanslutna företag
en ny MCP-klientregistrering i ChatGPT och ett nytt klientgodkännande.
Under **ChatGPT** finns installationsadressen och instruktionerna. **Status**
visar de faktiska spärrarna. **English** växlar språk. Ingen modellnyckel krävs.

Under **Företag → Kontrollera anslutning** visas diagnostik med korrelations-ID.
Saknad scope skiljs från frånkoppling och tillfälliga upstreamfel. Om Fortnox inte
anger en säker orsak visas behörighet/licens som okänd. Ett lyckat läsprov
aktiverar ingen bokföring, filoperation eller granskningsfunktion.

## Backup, återställning och uppgradering

Stoppa tjänsten med `docker compose -f deploy/docker/compose.yaml stop fortnox-mcp`.
Alla driftkommandon kräver underhållsläge och samma installationslås; de vägrar
köra samtidigt med applikationen. Kör exempelvis från repots rot:

```sh
docker compose -f deploy/docker/compose.yaml run --rm --no-deps -e MAINTENANCE_MODE=true fortnox-mcp node /app/dist/product-ops.js backup /data/backup.enc
```

Exportera den krypterade filen till en privat backupkatalog (0700, filer 0600).
Förvara backupnyckeln och databasens krypteringsnycklar separat. Backupen innehåller
inte sina egna nycklar. Gränsen är 64 MiB SQLite-state. Se den engelska guidens
exakta Compose-kommandon för kopiering och alla driftåtgärder.

**Restore:** behåll först en backup av nuvarande state. Kopiera den krypterade
backupen till datavolymen och kör `restore /data/backup.enc` under underhåll.
Starta igen. Alla gamla sessioner, klientgrants och granskningskapabiliteter
återkallas. Logga in, återanslut testföretagen och ge nytt klientsamtycke.
Okända utfall bevaras; ingen bokföring skickas om automatiskt.
Skrivningar förblir blockerade tills operatören stämt av hela tidsintervallet
som saknas i backupen. `restore-status` visar intervallet. `reconcile-restore`
kräver en privat attest med exakt restore-ID, från-/tilltid och hash av privat
evidens. Attesten aktiverar inga funktioner och löser inte enskilda okända utfall.

**Nyckelrotation:** stoppa, ta backup, lägg en ny 32-byte-nyckel i den privata
nyckelfilen och välj dess ID som aktivt. Behåll gammal nyckel, kör `rotate-keys`
och verifiera med endast den nya nyckeln. Förvara gamla nycklar separat för gamla
backuper. Byt auth-/backuphemligheter via deras privata filer; skapa ny backup.

**Uppgradering:** behåll föregående image, välj granskad ny image och kör
`upgrade /data/fore-uppgradering.enc` innan start. Kontrollera hälsa, inloggning,
anslutningar samt väntande/okända operationer. Starta inte gammal kod mot en ny
migrerad databas. Återställ vid behov med matchande kod, backup och nycklar.
`cleanup` rensar utgångna tillfälliga filer och förslag; okända utfall skyddas.

Om bootstrapkoden gått ut kan operatören utfärda en ny med `bootstrap-code`.
`reset-owner` utfärdar en privat tiominuterskod för samma ägare; använd
`/reset-password`. Ange en ny privat utfil för koden och ta bort den efteråt.
Ingen kod eller hemlighet ska skickas till ChatGPT eller publika ärenden.

**Borttagning:** stoppa tjänsten, exportera nödvändiga privata backuper och ta bort
just installationens containrar. Radera datavolymen endast när all data avsiktligt
ska tas bort. Ta därefter bort Nginx-konfiguration och hemligheter enligt vald
bevaringstid. Använd ingen global Docker-rensning.

## Releaseunderlag och kända begränsningar

Operatören kan förbereda ett versionsbundet lokalt underlag med källarkiv, SBOM,
originallicenser, guider och checksummor. Med Dockeråtkomst kan det verifierade
imaget sparas i samma underlag. Se den engelska guidens kommando
`prepare-release.mjs`. Ingenting publiceras. Manifestet markerar alltid underlaget
som utkast utan distributionsgodkännande; rättighetsgranskning och faktisk
acceptans återstår.

Nuvarande gränser: Linux amd64, Node 24.19.0, 512 MiB container-RAM, en CPU,
två filer per anrop och högst 1 MiB per fil, tolv aktiva tillfälliga filer,
128 KiB per statepost och 64 MiB per backupdatabas. CPU-/minnesgränser är
konfiguration, ingen kapacitetsgaranti. CI mäter syntetisk HTTPS-hälsa;
ChatGPT-/Fortnox-last och den bredare G09-gaten är separata.
Faktisk slutacceptans med två företag, två kvitton, individuella granskningar och
återhämtning återstår. Bokföring, Fortnox-filer och granskningskörning är spärrade.
