# Granskad manuell bokföring — testversion

Milestone 3 innehåller validering, skyddade förslag, granskningsvy och säker
exekveringslogik. **Riktig bokföring är avstängd** i produktservern tills klient-
och Fortnox-verifiering finns. En ändrad policy aktiverar ingen overifierad
operation. Använd endast uttryckligen tillåtna testföretag.

## När funktionen är verifierad

1. Lista företagets faktiska år med `list_financial_years` och dess opaka
   `company_id`. Välj ett returnerat års-ID efter datumintervallet; ett
   kalenderår, exempelvis 2026, är inte automatiskt ett års-ID. Använd sedan
   `get_accounting_references` med samma företag och valt `financial_year`.
   Läs konton, år, serier,
   låst period och dimensioner. Det finns inget globalt aktuellt företag.
2. Ange datum, serie, beskrivning, SEK och vanliga debet-/kreditrader. Belopp
   anges som decimaltext, exempelvis `"125.00"`. Servern hittar inte på konto,
   belopp, moms eller en balanseringsrad.
3. Använd `validate_manual_voucher` för kontroll utan lagring. Skrivskyddad
   anslutning får validera men inte spara ett bokföringsförslag.
4. Med uttrycklig skrivbehörighet: förbered ett oföränderligt förslag med
   `prepare_manual_vouchers`. Ett anrop gäller en verifikation; flera
   verifikationer måste balansera och granskas var för sig.
5. Kontrollera företag, år, datum, serie, beskrivning, alla rader, dimensioner
   och summor i granskningsvyn. Klicka **Bokför granskat förslag** bara när allt
   stämmer och klienten är verifierad. Chattext ersätter inte granskningsknappen.
6. Spara Fortnox-referensen och kontrollera resultatet. Fel efter klicket kan
   betyda att bokföringen redan genomfördes. Skicka inte ett nytt förslag för
   samma händelse innan utfallet är utrett.

Förslagets innehåll gäller högst 24 timmar; granskningsförmågan 15 minuter.
Ändrat innehåll/företag/urval/policy kräver nytt förslag och ny granskning.
Denna version stöder inte bilagor, negativa/korrigerade/borttagna rader, andra
valutor eller uppdatering av befintlig verifikation. Balans bevisar inte rätt
kontoval eller momsbehandling.

## Policy och okända utfall

Ägaren hanterar policy på `/admin`. Standard är **Mänsklig granskning krävs**
och **Skrivskyddad**. **Klientens godkännanden** är ett medvetet val av
`client_managed`; samma validering och beständiga skrivspärrar gäller.
Modellen kan inte ändra policy. Återanslutning återställer säkra standardval
och kräver nya grants.

Vid `outcome_unknown`: använd **Kontrollera status**. Okänd eller otillgänglig
status betyder inte att bokföringen misslyckades. Ingen automatisk omsändning
sker, inte heller efter omstart. Om betrodd referens saknas måste ägaren utreda
i Fortnox och registrera den exakta referensen under **Utred okända utfall** i
administrationen. `reconcile_voucher_execution` kan sedan stämma av hela
verifikationen. Datum och belopp ensamt bevisar inte identitet.

Frånkoppling stoppar väntande arbete men kan inte återta redan skickade anrop.
Krypterade förslag rensas vid utgång eller definitivt resultat; minimal
information om okända utfall bevaras för utredning.

## Privat konfiguration och liveacceptans

Behåll hemligheter i befintlig privat `.env`; se [ENV-guiden](env.sv.md).
Ny variabel: `ACCOUNTING_REFERENCES_ENABLED=false`. Referensprov får endast
slås på i den separata tillåtna tvåföretagsinstallationen. Flaggan aktiverar
inte bokföring och godkänner inga providerregler.

Efter en uppdatering som lägger till årsläsningen: uppdatera verktygslistan
(Refresh/Reload tools) i den redan godkända klienten. Ett nytt verktyg medför
ingen automatisk utökning av företag eller scopes. Börja med att lista år
för vart och ett av de två företagen. Tom eller ofullständig lista ger ingen
grund för att gissa års-ID eller godkänna ett bokföringsförslag.

En fullständig referensläsning kan innehålla informationsregeln `UNKNOWN`.
Det betyder att servern har läst en inställning vars betydelse ännu inte är
verifierad. Ett sådant konto kan inte användas för ett godkänt förslag, även
om listan är fullständig. Numeriska inställningar översätts inte på chans.
Saknad informationsinställning visas också som `UNKNOWN`. Fortnox namngivna
regel `MANDATORY` betyder obligatorisk och visas internt som `REQUIRED`;
krävd information och dimensioner måste då anges uttryckligen.

Vid det separata operatörsprovet den 6 november 2026 kunde båda testföretagens
referenser läsas efter rättningen. Varje kontolista nådde gränsen på 500 poster
och gav `complete=false`; informationsinställningen saknades och redovisades
som `UNKNOWN`. Ett lyckat läsanrop är därför ännu inte ett godkänt
bokföringsunderlag. Förslagsflödet kräver fullständiga, verifierade regler för
de konton som används. Operatörsprovet ersätter inte ett nytt prov i ChatGPT.

För ett uttryckligt kontourval kan `get_accounting_references` ta
`account_numbers` med 1–20 olika kontonummer. Ange endast konton som faktiskt
har valts för underlaget. Servern läser då kontodetaljer och redovisar urvalet i
svaret. `complete=true` gäller det urvalet och övriga referenser, inte hela
kontoplanen. Utan urval finns den tidigare begränsade listläsningen kvar.

Validering och förberedelse väljer själva de konton som anges i raderna;
exekvering använder kontona i det sparade, oföränderliga förslaget. Högst 20
olika konton kan användas i denna avgränsade profil. Okända regler och ännu
inte verifierade finansiella krav blockerar fortfarande bokföring. Uppdatera
verktygslistan efter deployment för att se det valfria kontourvalet.

Det separata operatörsprovet av kontodetaljer den 6 november lyckades för två
faktiskt listade konton per testföretag: urvalen var kompletta och saknade okända
informationsregler. Det bevisar läskontraktet för dessa konton. Finansiella
regler och mänsklig granskning återstår fortfarande före bokföring.

Om ett Fortnox-svar har oväntad struktur returneras `UPSTREAM_UNAVAILABLE`
med operationens fasta felorsak och säkra fältnamn i `fields`. Det behöver
utredas av operatören; byt inte företag eller års-ID för att försöka komma
runt felet. Råa providersvar eller credentials behövs inte i felrapporten.

En privat mall finns lokalt i `.data/milestone-3-acceptance.json` (0600,
ignorerad av Git). Fyll i testinstallationens `origin`, dess exakta
`serverCommit`, en kortlivad **MCP**-`accessToken` med läsrätt samt två
`companies` med `company_id` och `financial_year`. Använd inte Fortnox-token
eller Client Secret i detta fält. Kör `ACCOUNTING_ACCEPTANCE_CONFIRM=test-companies-only npm run test:accounting`
för enbart referensläsning. Resultatet är redigerat och godkänner inte finansiella
regler eller mänsklig granskning. `npm run test:accounting:record` kontrollerar
formen på en komplett manuell evidenspost; det utför inga browser-/providerprov.
Ofullständig konfiguration/evidens ger felkod i processen, inte ett godkännande.

Fortnox-integrationen behöver licens och tillämpliga behörigheter:
`bookkeeping`, `settings`, `costcenter`, `project`, `companyinformation` och
`profile`. Nya scopes kräver nytt consent, inte bara portaländring. Tidigare
anslutningar/MCP-grants breddas inte automatiskt. Skicka aldrig credentials,
tokens, callbackkoder eller privata företags-/verifikationsuppgifter i issues.

Dokumentera privat innan gates kan stängas:

- Exakt servercommit, deployment, klient/version, datum och två tillåtna tenants.
- Verkliga referenssvar/pagination i båda företag, brutet år, inaktiva konton,
  låsgräns och negativa scope-/rättighets-/tenantfall.
- Faktisk precision, tecken och rad-/korrigeringsregler. Otestade fall avvisas;
  licens eller saknad rättighet får inte gissas.
- Faktisk ChatGPT-granskning under restriktiv CSP: korrekt innehåll, mänskligt
  klick, en beständig konsumtion, remount/replay, expiry och statusfel.
  Appverktyg och capability får inte nå modellens kontext.
- En uttryckligen granskad testverifikation med exakt Fortnox-referens och
  avstämning av samtliga rader. Osäkert utfall måste utredas före omsändning.

Publicera endast redigerade resultat och begränsningar. #76/#92/#93 är
evidenskrav; hela G06/G07 godkänns inte av milestone 3, grönt CI eller merge.
