# Granskad manuell bokföring — testversion

Milestone 3 innehåller validering, skyddade förslag, granskningsvy och säker
exekveringslogik. **Riktig bokföring är avstängd** i produktservern tills klient-
och Fortnox-verifiering finns. En ändrad policy aktiverar ingen overifierad
operation. Använd endast uttryckligen tillåtna testföretag.

## När funktionen är verifierad

1. Ange företagets opaka ID och räkenskapsårets ID. Läs konton, år, serier,
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
