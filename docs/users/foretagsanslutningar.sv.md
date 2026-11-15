# Säkra företagsanslutningar

Aktuellt från 11 november 2026: test- och aktiveringsspärrarna är borttagna
i den vanliga installationen. [Funktioner och åtkomst](funktioner.sv.md)
beskriver nuvarande beteende och kvarvarande tekniska förutsättningar. Äldre
testprotokoll nedan beskriver tidigare versioner.

Kvittoprovets `inbox connectfile` kan väljas i programmets sidodialog när
operatören aktiverat testvalet `FORTNOX_RECEIPT_CONSENT`; se [ENV-guiden](env.sv.md). Det utökar inte gamla
anslutningar. När det faktiska filprovet ska genomföras behövs nytt ägarinitierat
medgivande för respektive tillåtet testföretag och aktuella MCP-behörigheter.
Samma tenant behåller handtaget men får en ny anslutningsgeneration vid
återanslutning. Kontrollera först olösta utfall och följ
[filprovets förutsättningar](../implementation/M04-G06-files.md).

Börja med [ENV-konfigurationen](env.sv.md) för privata värden och startkommandon.

Detta är produktimplementation under verifiering. Implementerade operationer
är aktiverade i den vanliga installationen. Testkörningar använder separat
installation och uttryckligen tillåtna testföretag.

## En klientanslutning för dina företag

När du ansluter AI-klienten godkänner du åtkomst till alla företag som du
ansluter till denna Fortnox MCP-installation, nu och i framtiden. Därefter blir
nya företag tillgängliga via samma klientanslutning. Kör `list_companies` i
klienten för att hämta den aktuella listan. Även ändrad programåtkomst och en
verifierad återanslutning av samma företag följer med utan nytt klientgodkännande.

För äldre klientgodkännanden: öppna **AI-klienter** och välj **Tillåt alla
nuvarande och framtida företag** för den klient du vill uppgradera. Det behövs
bara en gång och kräver ingen omanslutning i AI-klienten. Äldre godkännanden
förblir avgränsade tills du gör detta. Utgången eller återkallad klientinloggning
kan fortfarande kräva ny inloggning. Externa appars avgränsade godkännanden
hanteras i deras eget anslutningsflöde.

Skrivskydd, granskningskrav och klientens beviljade läs-, skriv- och filbehörigheter
gäller per anrop. Ett nytt företag får fortfarande grundpolicyn skrivskydd och
obligatorisk granskning. Frånkoppling stoppar åtkomsten direkt. Gamla förslag
eller okända skrivutfall återaktiveras inte av den gemensamma företagsåtkomsten.

## Ägare och inloggning

**Inställningar** visar API-uppgifternas status. Välj **Ange Fortnox API uppgifter**
för att öppna den separata, inloggningsskyddade sidan med Client ID och Client
Secret. Uppgifterna visas inte igen efter att de sparats. **Godkänd** visas när
de matchar en aktiv företagsanslutning; enbart sparande är inte en verifiering.
**Glöm** rensar uppgifterna för nya anslutningar och avbryter oanvända
samtyckeslänkar. Redan anslutna företag och deras behörigheter behålls.

Installationsoperatören skapar en privat engångskod med tio minuters giltighet. Öppna `/setup`, ange koden, din e-postadress och ett lösenord på minst tolv tecken. Inga koder, lösenord eller Fortnox-hemligheter ska klistras in i AI-konversationen. Därefter används `/sign-in`; sessionen gäller högst ett dygn. Inloggningen begränsas gemensamt för installationen för att motverka upprepade försök.

Om ett åtkomstskydd framför installationen avvisar formuläret visas ett
inloggnings- eller anslutningsfel. Kontrollera då även åtkomstskyddets inloggning. Privata svar från mellanliggande proxyer visas inte som feltext.

API-svar vid anslutningsfel innehåller begränsade felkoder för steg och orsak.
Efter upprepade anslutningsförsök kan du under **Drift** välja
**Avbryt väntande samtycken i denna session** innan du startar om. Avbrottet
ogiltigförklarar oanvända länkar i samma inloggning; det kopplar inte från
anslutna företag och avbryter inte ett tokenutbyte som redan påbörjats.

Operatören kör `node --import tsx scripts/product-operator.ts .data/operator.json` med privat JSON innehållande `origin`, `secret`, `database`, `output` och `action` (`bootstrap` eller `reset`). Återställning kräver också ägarens `email`. Filen och utdata ska ligga utanför git med privata filrättigheter. Databasens migrationer ska redan vara applicerade. Hemligheter ska inte skickas som kommandoradsargument.

För D1: skapa motsvarande engångskod privat, beräkna SHA-256 och sätt en tio minuters sluttid. Importera en granskad privat SQL-instruktion som endast infogar posten `installation`/`owner` i `product_state` om den inte finns (`ON CONFLICT DO NOTHING`), med version 1 och värdet `{phase:"ready",ownerId:"",tokenHash:<hash>,expiresAt:<UTC-millis>}`. Kontrollera att exakt en post skapades. Återanvänd aldrig en befintlig installations ägare eller hemligheter. Produktionskonton ingår inte i testet.

Om bootstrap avbryts efter att koden förbrukats måste operatören utreda befintligt konto och tillstånd; starta inte om genom att radera ägaren. Glömt lösenord återställs genom en ny privat biblioteksgenererad kod, som gäller i tio minuter. Skicka den med det nya lösenordet till samma origins `/auth/reset-password`; koden kan användas en gång och tidigare adminsessioner återkallas. Ägaridentiteten bevaras. E-postutskick och offentlig registrering ingår inte.

För Worker/D1: operatören förbereder privata `.data/product-recovery.json` med `origin`, den befintliga ägarens `ownerId` från installationens lagring och ägarens `email`. `.env` ska innehålla installationens `AUTH_SECRET`. Kör `npm run prepare:product:recovery`, applicera `.data/product-recovery.sql` en gång på rätt D1-databas och kontrollera att exakt en rad ändrades. Vid noll ändringar ska ägaruppgifterna, databasen och kodens giltighet kontrolleras; ägaren ska inte ersättas.

Öppna sedan `<PUBLIC_ORIGIN>/reset-password` och ange koden från `.data/product-recovery-code.txt` och ett nytt lösenord på minst tolv tecken. Logga in igen efter återställningen. Håll båda utdatafilerna privata och ta bort dem efter användning; återimportera inte gammal återställnings-SQL. Koden, lösenordet och callback-adresser med query-parametrar ska inte läggas i chatten.

## Kryptering och företag

Credentials krypteras med en extern 32-byte-nyckel (base64). Förvara nycklarna separat från databasen och dess backup. Varje nyckel har ett ID; behåll den gamla under en kontrollerad nyckelrotation och verifierad återställning. Saknad eller fel nyckel blockerar åtkomst.

Nyckelkontrollen gäller även privata företagslistor och status, och finns kvar efter frånkoppling när credentials har raderats. Vid flera nyckelversioner måste alla nycklar som fortfarande används finnas kvar. Äldre experimentella anslutningar uppgraderas först när befintliga credentials kan dekrypteras; annars spärras åtkomsten och operatören behöver återställa den korrekta konfigurationen. Radera inte ägaridentiteten eller byt nyckel på chans.

Installationen har högst 20 anslutningar. Företag får opaka stabila handtag; samma Fortnox-tenant kan inte läggas till två gånger. Äldre avgränsade klientgodkännanden binds till aktuell anslutningsgeneration; godkännanden för alla anslutna företag följer ägarens aktuella anslutningar. Grundpolicyn är skrivskydd och obligatorisk granskning av framtida manuella verifikationer.

## Anslut AI-klienten

Produktens MCP-adress är `/mcp`. Endast fasta protokolluppgifter är offentliga. Företagsanrop kräver ägarens OAuth-godkännande med `mcp:read offline_access`; Fortnox-token kan inte användas som MCP-token.

Det vanliga godkännandet omfattar nuvarande och framtida anslutna företag enligt
avsnittet ovan. Äldre avgränsade godkännanden kan uppgraderas under **AI-klienter**.
Ett nytt OAuth-godkännande på samma klientregistrering är också möjligt, men ger
nya token och ersätter föregående godkännande. **Reload tools** ändrar inte ett
sparat företagsgodkännande. Lokala tester verifierar serverns beteende;
faktiskt beteende i respektive värdklient återstår att verifiera.

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

Återanslutning kräver nytt Fortnox-godkännande och företagskontroll. Samma tenant behåller sitt företagshandtag men får ny behörighetsgeneration; ett annat företag får ett nytt handtag. Klienter med åtkomst till alla anslutna företag kan använda samma anslutning efter företagskontrollen. Äldre avgränsade godkännanden behöver uppgraderas eller förnyas. Gamla granskningsunderlag återfår inte giltighet genom återanslutningen.


## Vad är verifierat?

Den lokala implementationen och dess syntetiska Node-/workerd-tester är separata från verkliga Fortnox- och ChatGPT-prov. #75 gäller anslutning och företagsläsning. Senare referens-, verifikations- och filoperationer verifieras i #92–#94. Inget ärende stängs genom att enbart flytta krav eller slå på en miljövariabel.

## Om anslutningen misslyckas

Kontrollera att Client ID tillhör rätt integration, att `companyinformation` och `profile` är valda i Fortnox utvecklarportal och att redirect URI är exakt installationens `/admin/fortnox/callback`. Fortnox beskriver `invalid_scope` i sin [felsökningsguide](https://www.fortnox.se/developer/faq); de giltiga namnen finns i [scope-listan](https://www.fortnox.se/developer/guides-and-good-to-know/scopes).

Produktens felresultat kan innehålla `stage`, `reason`, `provider_error` och `provider_status`. De anger ett begränsat felsteg och redigerade felkoder, utan tokens eller providersvar. Återge detta JSON-resultat vid felsökning. Kopiera inte callback-adressen eller dess query-parametrar: där kan det finnas en engångskod och state.

Starta alltid ett nytt försök från administrationen efter en korrigering. En förbrukad kod eller förnyelsetoken skickas inte igen på chans. Ett generiskt eller okänt fel ska inte tolkas som bevis för saknad licens eller behörighet.

## Företag och program

Slutför ett Fortnox-godkännande i taget i samma webbläsarsession. Om ett annat
godkännande väntar stannar den nya anslutningen på MCP-sidan med en förklaring.
Slutför det första eller välj **Drift → Avbryt väntande samtycken i denna
session** och starta ett nytt försök. Återspela inte en gammal callback.
Separata inloggade sessioner kan fortfarande arbeta parallellt. Befintlig
företagsåtkomst behålls tills ersättningen har verifierats.

Öppna **Företag** för att söka efter eller lägga till ett företag. Den första
anslutningen begär bara företagsuppgifter och profil. Fortnox-svaret kontrolleras
innan företaget sparas.

Välj företaget och öppna **Översikt**, **Bokföring**, **Fakturering**,
**Order & offert**, **Lön** eller **Åtkomst**. Företagsväljaren byter företag utan
att blanda deras programval. Adressen kan bokmärkas; bakåtknappen fungerar.

Programlistan skiljer på **Anslutning** och **Tillgängligt**. **Anslutet** betyder
inte att alla funktioner fungerar eller att en licens har verifierats. Funktionsrader visar ansluten åtkomst, saknad åtkomst eller skrivskydd. Teknisk verifiering redovisas separat. Saknat providerstöd visas som
**Stöd planeras**. Ett generellt behörighetsfel bevisar inte att licensen saknas.

När **Anslut** är tillgängligt visar sidodialogen företaget, redan anslutna program
och de funktioner som faktiskt läggs till. För anslutna program heter åtgärden **Uppdatera åtkomst**. Kvitton visas i åtkomstsammanställningen utan en låst kryssruta. Om rätt Fortnox-behörigheter redan finns kan du godkänna funktionsvalet lokalt; annars fortsätter flödet till Fortnox. Ett val utan ändringar startar inget nytt samtycke.
Befintlig lokal åtkomst behålls tills ersättningen har verifierats. Ett avbrutet
eller misslyckat flöde visas tydligt; kontrollera anslutningen om Fortnox kräver ny
inloggning. Väntande samtycken kan avbrytas under **Drift**.

Företagets ID, skrivskydd och verifikationspolicy behålls efter en utökning. Gamla förslag återaktiveras inte. Klientgodkännanden för alla anslutna företag
följer ändringen. Äldre avgränsade klientgodkännanden kan uppgraderas under
**AI-klienter** eller förnyas genom klientens godkännandeflöde. **AI-klienter** visar sparade företagsgodkännanden och om de
fortfarande gäller, men inte om klienten har en aktiv inloggning.

**Inaktivera program lokalt** stoppar programmets funktioner på servern.
Fortnox-scopes återkallas inte; andra programs gemensamma åtkomst bevaras. För att
återaktivera programmet krävs ett nytt anslutningsflöde. Programändringar blockeras
vid ett pågående eller okänt skrivutfall tills det har stämts av. Ett separat tillägg för saldon och transaktioner kan godkännas trots ett äldre okänt utfall när befintliga Fortnox-behörigheter räcker. Anslutning, policy och det gamla utfallet bevaras. Pågående skrivningar blockerar fortfarande ändringen. Krävs nya Fortnox-behörigheter kan äldre utfall utan säker företagsbindning fortsatt blockera ersättningen. Ett separat Lön-samtycke kan dock läggas till vid ett äldre företagsbundet registerutfall. Utfallet behålls och fortsätter blockera nya skrivningar; ägaren kan läsa om det under Drift. Befintlig
**Koppla från** finns under företagets **Åtkomst**.

**Inställningar** innehåller ägare och Fortnox API-uppgifter. **Drift** innehåller
verifieringsstatus, återställningsspärr och olösta verifikationsutfall. Inga nya
bokförings-, betalnings- eller filoperationer aktiveras av denna vy. Faktureringens
registerprov behåller sin särskilda tidsgräns och testkonfiguration. Betalregistrering
är inte valbar innan stöd finns och betyder då bokföring av en redan genomförd
betalning.

## Kontrollera ett okänt kvittoutfall

Under **Drift → Olösta skrivutfall** visas berört steg och **Kontrollera utfallet**
när kvarvarande underlag medger avstämning. Ägaren kan läsa originaluppladdning
eller filkoppling även om klientens godkännande har blivit gammalt. För äldre
poster utan dokumenterad företagsbindning krävs samma anslutningsversion.
Kontrollen skickar ingen ny uppladdning, verifikation eller filkoppling. Ett
saknat eller tvetydigt fynd lämnar utfallet okänt och är inte skäl att försöka igen.

En verifikation med bevarad eller ägarregistrerad exakt Fortnox-referens kan också
stämmas av under **Drift** efter ett nytt klientgodkännande. Kontrollen jämför
hela ursprungsförslaget och kräver samma anslutningsversion. Saknad referens eller
avvikande innehåll lämnar utfallet okänt; ingen ny verifikation skickas.

## Anslut från en annan app

Registrerade appar med egen backend kan använda ett separat, uttryckligen aktiverat [guidat anslutningsflöde](extern-appanslutning.sv.md). Det påverkar inte vanliga MCP-klienter eller den fristående företagsanslutningen.
