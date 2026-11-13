# Funktioner och åtkomst

Från ändringen den 11 november 2026 kan den vanliga installationen ansluta
företag utan testläge, lista med exakt två testföretag eller tidsbegränsat
specialbygge. Spara Fortnox API-uppgifterna under **Inställningar**, välj
**Lägg till företag** och godkänn anslutningen hos Fortnox.

Anslut sedan önskade program på företagets sida. Implementerade verktyg för
bokföring, register, offerter/order/kundfakturor, analys, reskontraläsning,
timlöneunderlag och kvitton finns i det vanliga bygget. Fortnox-behörighet och
licens behöver fortfarande finnas för respektive funktion. Funktioner som inte
är implementerade tillkommer inte genom att testspärrarna tas bort.

Företagets sparade skrivskydd och verifikationspolicy gäller fortfarande. Ändra
dem under företagets **Åtkomst** om du vill tillåta skrivningar. Standard för
manuella verifikationer är granskning i en klient med MCP Apps-stöd. Ägaren kan
uttryckligen välja klientens vanliga godkännanden i stället. AI-verktygen kan
inte ändra policyn eller godkänna sina egna förslag.

Nya programbehörigheter kräver nytt Fortnox-medgivande. När anslutningen ändras
behöver även AI-klientens företagsgodkännande förnyas. Befintliga godkännanden
utökas inte automatiskt.

Kvittofiler behöver en konfigurerad filtransport och godkända HTTPS-källor.
Löneunderlag omfattar det implementerade timlöneflödet med löneart 11 och
faktiska anställnings-/löneuppgifter, inte en full lönekörning. Analyser visar
ofullständiga eller okända underlag när tillräckliga källdata saknas.

Beloppskontroller, balansering, företagsisolering och skydd mot dubbla
skrivningar gäller. Vid okänt skrivutfall ska den befintliga operationen
stämmas av innan ett nytt försök görs.

Aktivering är inte samma sak som verifiering i verkliga Fortnox-/ChatGPT-flöden.
[Tekniskt ändringsprotokoll och kvarvarande verifiering](../implementation/product-activation-2026-11-11.md).

**Uppdatera åtkomst** visar vilka funktioner som läggs till. Kvittoåtkomst ingår
i sammanställningen när den begärs; tidigare bortval ändras inte automatiskt.
När nödvändiga Fortnox-behörigheter redan finns godkänner ägaren funktionsvalet
lokalt. Datumläsning kan läggas till separat från andra funktioner även om en
äldre skrivning har okänt resultat. Utfallet och dess skrivspärr bevaras.

Efter en åtkomständring kan samma AI-klientregistrering få ett nytt uttryckligt
företagsgodkännande. Gamla token får inte utökade rättigheter. Gränssnittet visar
faktisk åtkomststatus; kvarvarande verifiering redovisas i tekniskt underlag.
Ägaren kan kontrollera kvittofilers okända utfall under **Drift**, utan omsändning.
