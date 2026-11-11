# Kvarstående acceptansprov

Den [daterade acceptansgranskningen](../implementation/acceptance-audit-2026-11-11.md)
skiljer faktiska resultat från återstående krav. Alla prov får använda AI med
separat AI-granskare enligt [beslutad arbetsgång](../implementation/ai-reviewed-acceptance-2026-11-11.md).
Använd bara de två redan godkända sandlådorna. Samordna frågor och driftfönster
i chatten **Skapa deploy-workflow för Fortnox MCP**.

Det kända osäkra offertintentet i #131 är avstämt genom ordinarie lager på
den rättade driften, utan nytt create. Båda testofferterna är annullerade och
syntetkunden är inaktiv efter separat granskad städning. Filprovet pågår;
Test 1 tillåter tillfälligt skrivningar med `review_required`.
Återställt skrivskydd ska bekräftas när testomgången är avslutad.

## Lås upp filproven — #33/#68/#69

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
4. Kontrollera att inget lagras före **Lagra tillfälligt**. Lagra båda och jämför
   originalens byteantal, MIME och SHA-256 med autentiserad återhämtad output.
5. Prova för stor fil, fel format, utgången referens och främmande företags-/
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
4. Använd en syntetisk anställd i testföretaget med giltig anställning,
   daterad timlön och implementerad kod 11. Tom anställdlista räcker inte.
   En befintlig separat operatörs-helper kan förbereda ett fast syntetiskt
   anställnings-/0,01-löneunderlag via samma skrivlager. Den saknar exponerat
   MCP-/driftkommando; en privat ingång måste granskas och använda faktiskt
   auktoriserad identitet/grant, tvåföretagsallowlist och tidsbegränsad lease.
   Skapa inga grants eller direktanrop till providern för att kringgå detta.
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
