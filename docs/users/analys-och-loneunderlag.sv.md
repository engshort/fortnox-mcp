# Finansiell analys och löneunderlag

Arbetet med milstolpe 7 pågår. Funktionerna är ännu inte aktiverade i den vanliga
installationen. [Leverans och faktisk verifiering](../implementation/M07-analysis-payroll.md)
redovisas separat från lokala tester.

En analys för ett visst datum ska bygga på ingående balans plus bokförda rörelser
fram till datumet. Årets utgående balans ersätter inte den beräkningen. Rapporten
visar företag, räkenskapsår, valuta, period, källor, hämtningstid och avstämning.
Saknade sidor eller saldon gör underlaget ofullständigt. Egna och inaktiva konton
behålls; konton utan verifierad klassificering visas som oklassificerade.
Bokförda bankkonton beskriver bokföringen, inte bankens aktuella saldo.

Det planerade löneflödet gäller ett avgränsat underlag för en verifierad
anställd, dag och lönekod. Företaget behöver rätt Fortnox-licens, behörigheter
och ett nytt samtycke för Lön. Ett samtycke aktiverar inte overifierade operationer.
Full löneberäkning, lönebesked och utbetalning ingår inte.

Ett verifierat sandlådeexempel är att förbereda ett uttryckligt timunderlag för
en syntetisk testanställd och därefter skapa, ändra och ta bort det. Hela kedjan
har passerat produktens MCP-lager och Fortnox med separat återläsning. Faktisk
ChatGPT-acceptans återstår. Vid okänt resultat ska samma skrivning inte skickas
på nytt innan resultatet har utretts.

Driftsidan skiljer okända skrivutfall från ”Genomfört med avvikelse”. Det senare
betyder att skrivningen har en säker Fortnox-referens men att återläst innehåll
skiljer sig från förberedelsen. Du ser vilka fält som avviker. Det avsedda
resultatet räknas inte som godkänt, och samma skrivning skickas inte igen.
Kontrollera resultatet och förbered eventuell rättelse separat.

Den isolerade testbuilden kan erbjuda fyra läsverktyg för anställningsreferenser
och löneunderlag. Ange alltid företag; urval av underlag kräver även anställd
och datum. Anställningsreferensen visar inte namn, personnummer eller lön.
Läsning godkänner inte registrering, ändring eller borttagning av löneunderlag.
Finansiella underlag med ej verifierad exporttäckning redovisas som ofullständiga.

För att spåra en kontorörelse väljer du företag, räkenskapsår, konto och datum
i `list_financial_movements`. Fortsätt med den returnerade fortsättningen.
Byts underlaget behöver du börja om. Verifikationsreferensen kan sedan användas
i `get_financial_voucher`; varje sådan läsning kräver fortfarande företagsåtkomst.

`get_financial_account` läser Fortnox egna ingående och utgående värden för ett
bestämt konto och räkenskapsår. De är inte ett saldo på valfritt datum. Saknade
värden förblir saknade, och ej verifierade valutaenheter anges uttryckligen.

Ett smalt timlöneflöde är nu implementerat bakom avstängda operationsgränser.
Det kräver en verifierad anställd, dag, lönekod och timlön. Förberedelsen visar
hela avsedda underlaget och ändringarna. Om personalkortets timlön eller själva
underlaget ändras måste förberedelsen göras om. Skapande, uppdatering och
borttagning godkänns och verifieras separat. Månadslön är ännu inte godkänd.

I testbuilden kan `list_financial_accounts` visa kontoplanen i sidor om högst
100 konton. Fortsättningen hör till samma företag och räkenskapsår. Inaktiva
och egna konton behålls. En fullständigt hämtad kontoplan betyder inte att
saldon och en finansiell rapport är avstämda; de begränsningarna visas separat.

`compare_financial_periods` jämför upp till 50 angivna konton mellan två
uttryckliga företag, räkenskapsår och perioder. Båda företagen kräver åtkomst.
Varje underlag visar egna källor och begränsningar. Olika valutor eller
oförenliga definitioner ger ingen beräknad differens. Jämförelsen gör ingen
valutaomräkning eller juridisk koncernredovisning.

Operatören kan öppna ett tidsbegränsat klientprov för den verifierade
anställda, dagen och lönekoden. Det aktiverar inte lönekörning, lönebesked eller
utbetalning. Vanliga installationer får inte automatiskt skrivåtkomst till Lön.

`list_receivables` och `list_payables` visar aktuell kund- respektive
leverantörsreskontra i begränsade sidor. Okända belopp eller statusfält visas
som okända. Sidans summeringar hålls per valuta och gäller bara sidan.
Historiskt obetalt belopp kan inte återskapas från dagens status. Förväntat
betalningsflöde beräknas först när valuta och kredittecken har verifierats;
förfallodatum är inget löfte om att betalning sker.

`get_liquidity_basis` kombinerar valda bokförda konton med en begränsad sida
kund- och leverantörsfakturor. Ange dagens datum, räkenskapsår och ett uttryckligt
antagande att betalning sker på förfallodagen, högst 90 dagar framåt. Resultatet
visar vilka källor och sidor som ingår. Okända belopp eller teckenregler kan ge
ett ofullständigt underlag utan beräknad prognos. Andra valutor räknas inte om,
och konton klassificeras inte automatiskt som bankkonton utifrån numret.
