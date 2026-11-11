# Register, försäljning och inköp

De implementerade funktionerna är aktiverade i vanliga produktbygget från
11 november 2026. [Funktioner och åtkomst](funktioner.sv.md) beskriver åtkomst
och begränsningarna i det implementerade stödet. Faktisk Fortnox- och
ChatGPT-verifiering redovisas separat och blir inte godkänd genom aktivering.

I testbuilden kan du be klienten att söka efter och läsa kunder, leverantörer,
artiklar och referenser för ett uttryckligen valt företag. Ofullständiga listor
markeras tydligt; nästa sida gäller samma företag och sökning. Referenser från
ett annat företag kan inte användas för att fylla i saknade uppgifter.

För att skapa eller ändra en registerpost förbereder du först ändringen, granskar
avsedd information och godkänner den vanliga verktygsåtgärden i klienten.
Förslaget visar tidigare och avsett innehåll samt ändringarna. Utelämnade fält
behålls vid uppdatering. Ändrat underlag eller ändrad företagspolicy kräver ny
förberedelse. Rensning av fält ingår ännu inte i den verifierade profilen.
Nya artiklar i profilen är tjänsteartiklar; lagerjustering ingår inte.

Om svaret från en skrivning försvinner blir resultatet osäkert. Då spärras nya
register- och dokumentskrivningar i företaget tills utfallet har avstämts.
Avstämning läser en känd Fortnox-identitet och skickar inte ändringen igen.
Saknad identitet eller oklart innehåll lämnar resultatet osäkert. Ett nytt förslag
får inte användas för att kringgå detta.

Fortnox kan returnera tomma kopiemottagare (CC/BCC) som `null`. Läsning och
avstämning behandlar just dessa uttryckliga tomvärden som tomma strängar.
Mottagare, saknade uppgifter och andra innehållsskillnader fylls inte i. En
befintlig osäker offert med känd referens ska avstämmas med samma intent, aldrig
skapas på nytt. Offert utan giltig huvudmottagare har fortfarande den öppna
redigeringsbegränsningen #130. Det innebär inget godkännande av utskick.

Betalregistrering avser bokföring av en betalning. Bankbetalningsinitiering ingår
inte. E-faktura, eprint och påminnelsekanaler är otillgängliga i denna leverans.
Aktuell verifieringsstatus finns i [operationstäckningen](../reference/coverage.md).

Dokumentadaptern har lokala tester för radbevarande, ändrade rad-ID:n och
avstämning av osäkra utfall. Operatören kan välja offert-, order- och
kundfakturaläsning i den tidsbegränsade testbuilden. Sammanställningar skiljer
ofullständiga uppgifter från detaljläsning och visar okända tillstånd uttryckligen.
Faktisk Fortnox- och klientacceptans återstår. Dokumentskrivningar är avstängda
i produkten. Utskick som får ett osäkert svar skickas aldrig automatiskt igen.
