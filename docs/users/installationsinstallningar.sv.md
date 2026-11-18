# Installationens inställningar

Öppna **Inställningar** i administrationen som installationsägare eller
administratör. Ändringarna gäller hela installationen och börjar gälla när du
sparar, utan omstart. Medarbetare kan inte ändra dessa inställningar.

## E-post

Under **E-post** anger du avsändaradress och Resend API-nyckel. Avsändarens domän
måste vara verifierad hos Resend. Markera **Skicka kontomejl** och spara för att
aktivera välkomstmeddelanden och lösenordsåterställning.

En befintlig nyckel visas aldrig. Ett tomt nyckelfält behåller den. Ange en ny
nyckel för att byta, eller välj **Radera sparad API-nyckel** för att ta bort den.
Stäng av kontomejl samtidigt om du tar bort nyckeln. Enbart sparade uppgifter
aktiverar inga utskick. Aktivering skickar inget välkomstmejl till befintliga konton.

En nyckel som anges av en administratör används inte för ägarens
lösenordsåterställning, eftersom leverantörskontots innehavare kan läsa
mejlinnehållet. Inställningssidan visar detta. Ägaren kan ange en egen känd
nyckel eller återställa till operatörens servernyckel. Övriga kontomejl och
medlemmars återställning kan fortfarande användas. Ägarens privata
operatörskod för återställning fungerar som tidigare.

## Användare

**Fleranvändarstöd** ger tillgång till medlemsadministrationen.
**Medlemssynkronisering via API** aktiverar det befintliga integrations-API:t och
kräver fleranvändarstöd. Länkar till medlemmar och integrationskällor visas när
stödet är aktiverat. Se [medlemsguiden](medlemmar.sv.md).

Om du stänger av fleranvändarstöd måste du också stänga av medlemssynkronisering.
Administratörer och medarbetare förlorar då sin åtkomst. Installationsägaren kan
fortfarande logga in och medlemsuppgifterna behålls.

## Integrationer

- **REST-API** gör det befintliga API:t tillgängligt.
- **REST-brygga** kräver REST-API och en separat granskad katalog.
- **Företagssynk** kräver REST-API och REST-brygga.
- **Realtidshändelser från Fortnox** kräver dessutom aktiverad synk och Node/Docker.
  Worker visar realtid som otillgänglig.
- **Företagsanslutning från externa appar** styr om tillåtna registrerade
  backendklienter kan starta det befintliga anslutningsflödet.

Spara beroende reglage tillsammans när du aktiverar eller stänger av funktioner.
Under reglagen visas om exempelvis en katalog saknas, även när funktionen är
aktiverad. Aktivering skapar inga företagsbehörigheter eller medgivanden.

Välj registrerade klienter i listorna för externa appanslutningar respektive
**Backendklienter med 30 dagars åtkomst**. Endast klienter med rätt
registreringsförutsättningar är valbara. En gammal eller inaktuell post kan tas
bort. Ny klientregistrering och tillåtna callback-adresser hanteras separat.

30-dagarspolicyn kräver fortfarande uttryckligt `offline_access`-medgivande.
Borttagning ur listan spärrar befintliga frikopplade tokenfamiljer. Om klienten
läggs tillbaka kan fortfarande giltiga familjer fungera igen; detta ersätter inte
permanent återkallelse eller nytt medgivande efter ett osäkert förnyelsesvar.
Se [guiden för externa appar](extern-appanslutning.sv.md).

Installationsägaren kan ladda upp ett färdiggranskat JSON-paket under
**Granskad REST-katalog**, högst 8 MiB. REST-API och REST-brygga måste vara
aktiverade först. Administratörer kan se revision och antal operationer.
Uppladdningen genomför ingen granskning och bevisar inget providerstöd.
Se [REST-bryggan](rest-brygga.sv.md).

## Analys

**Återanvändbara analysunderlag** aktiverar det befintliga stödet för ett
tidsbegränsat, bundet analysunderlag. **Större analysinläsningar** höjer
SIE-gränserna från 2 till 16 MiB och från 10 000 till 100 000 rörelser per export.
Separata minnes-, lagrings- och tidsgränser gäller fortfarande. Se
[analysguiden](analys-och-loneunderlag.sv.md).

## Grundvärden, konflikter och drift

Varje fält visar **Sparat i appen**, **Serverkonfiguration** eller
**Standardvärde**. Ett sparat appvärde går före servervärdet, även när du sparar
avstängt eller en tom lista. **Återställ till servervärde vid sparning** tar bort
appens överstyrning. För en API-nyckel är återställning något annat än radering:
återställning kan återanvända operatörens konfigurerade nyckel.

Om någon annan hunnit spara får du ett konfliktmeddelande. Välj **Hämta aktuella
värden**, kontrollera inställningarna och gör om dina ändringar. Om svaret på en
sparning saknas ska du också hämta aktuella värden innan du försöker igen.

Under **Drift → Serverkonfiguration** visas körmiljö, publik adress, tillåtna
klientcallbacks och filtransport. Dessa värden ändras av installationsoperatören.
Huvudnycklar, privata sökvägar och relätoken visas inte. Fortnox-uppgifter som är
låsta av operatören förblir låsta.

Avaktivering kan avbryta fortsatt arbete i ett pågående flöde. Redan skickade
skrivningar skickas inte om; kontrollera deras sparade utfall under Drift.
