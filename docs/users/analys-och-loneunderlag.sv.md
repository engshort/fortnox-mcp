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

Ett kommande exempel är att förbereda ett uttryckligt engångsunderlag för en
syntetisk testanställd, granska innehållet och därefter registrera det med vanlig
klientbekräftelse. Exemplet är ännu inte faktiskt godkänt i Fortnox. Vid okänt
resultat ska samma skrivning inte skickas på nytt innan resultatet har utretts.
