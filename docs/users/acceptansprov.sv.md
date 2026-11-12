# Kvarstående acceptansprov

Den [daterade acceptansgranskningen](../implementation/acceptance-audit-2026-11-11.md)
skiljer faktiska resultat från återstående krav. Alla prov får använda AI med
separat AI-granskare enligt [beslutad arbetsgång](../implementation/ai-reviewed-acceptance-2026-11-11.md).
Använd bara de två redan godkända sandlådorna. Samordna frågor och driftfönster
i chatten **Skapa deploy-workflow för Fortnox MCP**.

Det kända osäkra offertintentet i #131 är avstämt genom ordinarie lager på
den rättade driften, utan nytt create. Båda testofferterna är annullerade och
syntetkunden är inaktiv efter separat granskad städning. Två syntetiska PNG-filer
har nått krypterad lagring och hämtats autentiserat i den riktiga ChatGPT-vyn.
Första kvittots provideruppladdning fick däremot ett nytt osäkert utfall i #134,
innan någon kvittoverifikation eller bilagelänk skapades. Det andra kvittot
har inte körts. Skrivskyddet är återställt; `review_required` är oförändrad.

## Börja med uppladdningens osäkra utfall — #134

1. Öppna **Drift → Olösta skrivutfall**. Bevara originalets privata referenser
   och status. **Bokför** eller **Ladda upp** får inte användas som ett nytt försök.
2. [PR #135:s diagnostik och positiva avstämning](../implementation/receipt-upload-recovery-2026-11-12.md)
   är nu implementerade och driftsatta. Ett faktiskt `reconcile_receipt_upload`
   på originalet returnerade fortfarande `outcome_unknown`, utan betrodd
   providerreferens. `resume_receipt_batch` är ingen ersättning. Ingen
   uppladdning har skickats om och utfallet får inte markeras löst.
3. Undersök den avsedda sandlådans **Arkivplats → Inbox → Verifikationer**
   efter exakt originalfil. En eventuell träff måste kontrolleras mot rätt
   företag, filidentitet, byteantal, SHA-256 och tillräcklig unik evidens.
   Ägaren har nu slutfört BankID-inloggningen och agenten har verifierat rätt
   testföretag i Fortnox. Den nya läsningen visade 0 filer i verifikationsinkorgen.
   Den kontrollerade vyn för kopplade filer gav ingen originalkandidat;
   papperskorgen var satt till 0 procent. Behandlingshistorik för originaldatumet
   gav ingen korrelerad filhändelse. Detta bevisar inte att uppladdningen aldrig
   skedde. Ingen fil kunde laddas ned och jämföras, och inget har skickats om.
   Nästa förutsättning är ett providerägt audit-/originalsvar som entydigt
   korrelerar originalanropet med betrodd filreferens och faktiskt utfall:
   lämna det via samordningschatten. Ett tomt sökresultat eller antagande om
   avslag räcker inte. Ingen ytterligare BankID-inloggning efterfrågas nu och
   inget supportmeddelande har skickats.
4. Fixen och det faktiska kvarstående okända resultatet har separat AI-granskning.
   Låt granskaren även bedöma eventuell ny positiv providerbevisning.
   Stäm därefter av originalintentet genom det granskade återhämtningsflödet.
   Ändra inte status, referens eller versionsbindning direkt i databasen.
5. Återställt skrivskydd ökade policyversionen och ogiltigförklarade väntande
   förslag. Gamla batch-/filreferenser kan därför inte återanvändas normalt.
   Den nya avstämningen kan hantera bevarad uploadmetadata över denna
   policyskillnad men återaktiverar inte gamla förslag. Fortsatt bokföring
   behöver ett separat stött flöde med aktuell granskning, utan ny uppladdning
   som ersättning för originalets avstämning.
6. Först därefter kan kvittoflöde, bilagor och fler skrivprov fortsätta.
   AI-operatör och separat AI-granskare får utföra proven i samma två sandlådor.

## Komplettera filproven — #33/#68/#69

1. Chrome-inställningen har bekräftats av ägaren. Vid en ny installation: öppna
   `chrome://extensions` manuellt i Chrome-profilen som kör acceptanschatten.
   Välj **Information/Details** för ChatGPT-tillägget och aktivera
   **Tillåt åtkomst till filadresser/Allow access to file URLs**. Agentens
   webbläsarverktyg får bara öppna HTTP/HTTPS och kan inte göra detta steg.
   Om inställningen redan är aktiverad, meddela det. Ändringen är en dokumenterad
   förutsättning; en faktisk lyckad filöverföring måste fortfarande verifieras.
2. Meddela samordningschatten att inställningen är klar. Öppna den anslutna
   **Fortnox MCP Acceptance** och kontrollera båda företagsprofilerna.
   Om en programändring ger ett gammalt företagsgrant: använd en ny explicit
   klientregistrering tills #129 är löst; vanlig återanslutning är otillräcklig.
3. Välj Test 1 i produktens filväljare. Den inbäddade lokala filknappen gav
   fortfarande timeout, men **Lägg till → Lägg till bilder och filer** i den
   vanliga ChatGPT-vyn laddade upp båda syntetiska PNG-originalen A och B.
   Välj sedan exakt dessa två genom appens **Välj uppladdade filer**. Invänta
   avslutad inläsning och statusen **2 filer valda**; ett tillfälligt felmeddelande
   under inläsning är inte slutresultatet. Båda ryms inom 1 MiB och två miljoner bildpixlar.
   PDF-alternativet för A är samma testhändelse som PNG A, inte ett extra kvitto.
4. Tvåfilslagring och autentiserad UI-återläsning är nu verifierade med exakta
   PNG-byteantal och SHA-256. Den tillfälliga Node-transporten återställdes till
   `none` och tomma origins. En ny transportomgång behöver samma avgränsade
   driftförberedelse, två granskade HTTPS-origins och verifierad återställning.
5. För återstående faktisk diskoutput: välj **Hämta och kontrollera original**
   och **Ladda ner kontrollerat original** för var och en av filerna i en ny,
   giltig testomgång. Webbläsarverktyget kunde inte exportera Blob från den
   inbäddade vyn. Om du laddar ned dem själv i Chrome, meddela var filerna sparas;
   agenten kan sedan jämföra faktiska diskbytes/SHA-256. Länktext i appen är inte
   i sig bevis på en nedladdad fil. Äldre utgångna/policybundna referenser räcker inte.
6. Prova även PDF-output, för stor fil, fel format, utgången referens och främmande företags-/
   klientreferens. Ingen främmande byte får lämnas ut och inget får skickas om
   automatiskt. Dokumentera verklig filöverföring separat från lokal validering.

De tio levererade fotografierna ska inte ändras för att framstå som ett godkänt
originalprov. Nio överstiger nuvarande bytegräns. Det accepterade handskrivna
underlaget saknar uppgifter; tom moms eller årtal ska ge komplettering.
Flersidiga bank-/kravunderlag är inte ensamma bevis för betalning eller tidigare
bokföring. Publicera inte deras innehåll i issues eller PR:er.

## Individuell kvittogranskning och bilagor — #32/#70/#71/#93/#94

1. Läs faktiskt år, serie, aktuella konton, låsdatum och dimensionsregler.
   Använd uttryckliga syntetiska bank-/momsfakta; gissa inga saknade belopp.
2. Förbered varje kvitto separat och spara dess ID/hash/version, filidentitet,
   företag/generation, policyversion, exakta rader och egna totalsummor privat.
3. Låt den separata granskaren kontrollera varje oföränderligt förslag och
   urval. Utför endast den avsedda MCP Apps-granskningsåtgärden efter beslutet.
   Behåll `review_required`; ett `confirmed`-argument ersätter inte granskning.
4. Läs tillbaka exakt verifikationsreferens och rader. Ladda upp, koppla och
   hämta originalbilagan; jämför bytes och kontrollera fel års-/filrelation.
5. Prova remount, konkurrerande vyer, dubbelklick/replay, ändrad policy/hash,
   utgången granskning, annan webbläsare och förlorat svar. Ett lyckat vanligt
   manuellt förslag utan bilaga täcker inte dessa kvitto-/angreppsfall.
6. Återställ tillfälligt ändrat skrivskydd efter att alla utfall utretts.
   Bevara testposterna/referenserna och använd endast stödd granskad städning.

## Osäkra utfall och drift — #38/#39/#70/#71/#77

1. Kom överens om en enda dokumenterad felpunkt med driftoperatören. Stoppa
   andra skrivflöden; ändra inte den aktiva databasen som felinjektion.
2. Låt ett faktiskt accepterat skrivsvar försvinna och kontrollera
   `outcome_unknown`, beständigt intent och att status/restart inte skickar igen.
3. Stäm av ursprungsintentet via produktens återhämtning. Tom sökning bevisar
   inte att en osäker skrivning aldrig skedde.
4. Vid lyckad verifikation/uppladdning men bevisat misslyckad koppling:
   reparera endast kopplingen med samma sparade referenser. Kontrollera att
   ingen ny verifikation eller uppladdning skapas.
5. Prova krypterad snapshot/restore i separat kopia utan provider-egress och
   publik port, inklusive fel nyckel, gamla granskningar/sessioner och saknade
   intervall. Äldre snapshots får inte redovisas som ny backup av aktuell drift.
6. Mät representativt tvåkvittosflöde, CPU/minne/tid/bytes/state på vald Node-
   drift. Faktiskt hostade Worker-budgetar kräver ett eget prov; lokala workerd-
   tester och Dockerhälsa ersätter inte det. Ingen Cloudflare Tunnel behövs.

## Anslutningar och providerbehörighet — #58–#60/#62/#75/#92

1. Förbered en verkligt begränsad testanvändare/licenskonfiguration i en av de
   två sandlådorna. Dokumentera exakt scope, användarrättighet och produktlicens.
2. Prova tillåtna läsningar och separata avslag för saknat scope, rättighet och
   licens. Ett lokalt avstängt program bevisar endast lokal programkontroll.
3. Prova Fortnox användarläge och faktisk tokenförnyelse efter expiry, samtidig
   förnyelse, förlorat rotationssvar och ogiltig/revokerad refresh. MCP-klientens
   OAuth-rotation är ett separat flöde.
4. Koppla från och återanslut endast avsedd sandbox. Kontrollera att gamla
   grants, fil-/förslagshandtag och approvals förblir ogiltiga och att osäkra
   skrivutfall bevaras för utredning. Behåll den andra företagets isolering.
5. Prova verklig låst period, inaktivt konto och obligatorisk dimension med
   uttryckligen förberedd sandboxkonfiguration. Ändra inga regler för att få ett
   annars ogiltigt förslag att passera.

## Register, dokument, analys och lön — #21/#22/#25/#26/#40

1. Kund-/leverantörs-/artikelcreate, update och inaktivering har ett lyckat
   faktiskt grundprov. Komplettera med stödda referens-/prisfält, källversion som
   ändras före commit och osäkert utfall. Ingen generell deletefunktion antas.
2. Prova offert → order → obokförd kundfaktura och separata uppdateringar med
   uttryckliga syntetiska rader. Kontrollera rad-ID, avsedda kvarvarande rader,
   målfunktionens egen behörighet och stödd annullering. Skicka ingen e-post,
   e-faktura eller utskrift till extern mottagare utan särskild beställning.
   #130 blockerar fortsatt redigering även på ett adresserat utkast vars
   projicerade huvud/rader nu validerar. Isolera och verifiera återstående
   rådatakontroll innan detta fall räknas som klart.
3. Stäm av analys mot samma verifierade Fortnox-period/konton och fullständiga
   sidor. Luckor i ingående balans/SIE/valuta-/kreditsemantik kan kräva kodarbete.
4. Efter #134:s avstämning: använd en syntetisk anställd i testföretaget med giltig anställning,
   daterad timlön och implementerad kod 11. Tom anställdlista räcker inte.
   En befintlig separat operatörs-helper kan förbereda ett fast syntetiskt
   anställnings-/0,01-löneunderlag via samma skrivlager. Den saknar exponerat
   MCP-/driftkommando; en privat ingång måste granskas och använda faktiskt
   auktoriserad identitet/grant, tvåföretagsallowlist och tidsbegränsad lease.
   Fortnox egen meny **Lön** i Test 1 är åtkomlig men visar ännu en startguide.
   Den kan vara en legitim väg att förbereda fixturen efter stoppets lösning;
   inga löneinställningar sparades i denna testomgång. Skapa inga grants eller
   direktanrop till providern för att kringgå saknad autentiserad ingång.
   Prova create/update/delete, datum-/lönegränser och återläsning. Ingen
   löneutbetalning eller full lönekörning ingår.
5. Leverantörsfaktura-/betalningslivscykler och framtida moduler som ännu inte är
   implementerade behöver kodarbete före acceptans, inte fler operatörsklick.

## Externa förutsättningar och slutkontroll

1. Klargör externa källrättigheter och eventuell CLA-signering separat.
   AI-granskning ersätter inte avtal, källrättigheter eller signatur.
2. Beställ uttryckligen avsedd mottagare och syfte innan en faktisk privat
   säkerhetsrapport skickas. Inställningar är inte bevis på mottagen rapport.
3. Slutför #83 i dess registrerade Labstride-session med den planacceptans och
   native resultatrapportering som canary-issuet kräver. En annan docs-PR räcker
   inte som bevis på den körningen.
4. Kör slutlig ren installation/tvåkvittosomgång när förutsättningarna finns.
   Stäng endast issues vars hela återstående acceptans har granskad evidens.
   Stabil release och produktionskonton ingår inte i denna testomgång.
