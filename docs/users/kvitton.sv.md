# Kvitton och återhämtning

Milestone 4 är under implementation. Produktens filverktyg och bokföringsflöde är
avstängda tills respektive klient- och providerprov är godkänt. Ett tidigare
syntetiskt granskningsprov aktiverar inte bokföring.

I det avsedda flödet väljer du företag uttryckligen och bifogar upp till två filer
i klienten. Stödet börjar med PNG, JPEG och vanliga okrypterade PDF-filer utan
komprimerade objekt: högst 1 MiB per fil, två miljoner bildpunkter och tio PDF-sidor.
Lösenordsskyddade eller andra PDF-varianter avvisas; välj en stödd kopia av
originalet. Servern tolkar inte kvittot med OCR och behöver ingen modellnyckel.

Tillfälliga filer binds till din inloggning, klient, företag och arbetsflöde. De
lagras krypterade och kan återläsas genom autentiserade handtag i 55 minuter.
Normalt rensas filerna inom en timme. Ett driftavbrott kan fördröja fysisk rensning;
utgångna referenser fungerar ändå inte. Filåtkomst kräver nytt uttryckligt
klientmedgivande och utökar aldrig äldre medgivanden automatiskt.

Varje kvitto ska granskas separat med sitt eget företag, räkenskapsår, belopp och
underlag. Saknade uppgifter måste fyllas i; andra kvitton får inte användas för
att balansera ett fel. Uppladdning, bokföring och länkning är separata steg.
Efter ett avbrott ska du läsa status och följa återhämtningsanvisningen. Ett okänt
bokföringsutfall ska utredas i Fortnox innan något skickas om. En lyckad
verifikation med saknad bilaga behöver en reparerad länk, ingen ny verifikation.

De exakta manuella klientproven finns i
[utvecklarens verifieringsunderlag](../implementation/M04-receipts-evidence.md#human-client-acceptance-pending).
Använd endast uttryckligen tillåtna testföretag och syntetiska kvitton i dessa prov.

## Separat filprov i testinstallationen

Operatören kan driftsätta en särskild M14-testversion för **tillfällig filstaging
och hämtning av originalbytes**. Provfönstret gäller högst en timme; därefter
stängs MCP-provet medan ägarinloggning och filrensning fortsätter fungera.
Bokföring, Fortnox-filändringar och granskningskörning är fortfarande avstängda.

Logga in med installationens befintliga ägarkonto. Saknas lösenord används
operatörens engångsåterställning; skapa inte en ny ägare. Du väljer själv det
nya lösenordet och bekräftar återställningen. Skicka inga koder i chatten.

Skapa därefter en ny testanslutning i klienten och godkänn uttryckligen filåtkomst
(`mcp:files`). Ett gammalt medgivande utan filåtkomst utökas inte automatiskt.
För detta filprov behövs inga nya Fortnox-behörigheter. Vänta på besked om att
testversion och filtransport är redo innan du kör de två originalfilerna.
Se [operatörens exakta körsteg](../implementation/M04-client-file-test.md).

## Granska varje kvitto

Förberedelser kan samla upp till tio kvitton, med högst två filer per uppladdningsanrop
och tolv tillfälliga filer åt gången. Förbered ett nytt förslag med de uppgifter du faktiskt har kontrollerat i klienten.
Varje kvitto får egen status, egna rader och egna totaler. `needs_input` betyder
att uppgifter saknas, ett villkor är overifierat eller underlaget inte längre
fungerar. Servern fyller inte i luckorna. Ett likadant filinnehåll ger en
företagsbunden dubblettkandidat; kontrollera den innan du uttryckligen anger att
det är en separat transaktion.

Granskningskortet visar företag, underlagets identitet, datum, år, serie, samtliga
rader och differens per kvitto. Knappen gäller bara det kvittot. Ändras underlag,
poster eller urval krävs ett nytt förslag och ny granskning. Ett gammalt kort
skapar inget nytt godkännande när det läses in igen. Saknad kapabilitet eller
osäker status gör bokföringsknappen inaktiv. Bokföring är fortfarande avstängd i
produktinstallationen medan gransknings- och providerkraven återstår.

## Underlag i Fortnox

När flödet har verifierats och aktiverats laddas varje underlag upp separat och
länkas till just sin verifierade verifikation. Hämtning kräver åtkomst till både
företaget och den bokföringspost som bilagan hör till. En länk är ingen offentlig
nedladdningsadress. Befintliga anslutningar får inte filbehörigheter automatiskt;
ett nytt medgivande kan behövas.

`partial` betyder att något steg är klart men arbete återstår. `repair_link_only`
betyder att verifikationen redan finns och endast bilagans länk ska repareras.
Skicka inte verifikationen igen. `outcome_unknown` betyder att ett anrop kan ha
lyckats trots att svaret saknas; kontrollera Fortnox och sparad status innan något
försök görs. Omladdning eller omstart gör inte ett okänt utfall säkert att skicka om.
Produktens filoperationer är fortsatt avstängda tills de separata proven är klara.

## Efter ett avbrott

1. Välj samma företag och läs batchens sparade status. Varje kvitto har egna
   resultat för uppladdning, verifikation och bilagelänk, samt ett nästa steg.
2. Finns verifikationen redan men länken saknas, använd **Reparera endast
   bilagelänken**. Den skapar ingen ny verifikation eller upload.
3. Vid okänt utfall används **Utred sparad status**. En saknad träff bevisar inte
   att ett tidigare anrop misslyckades. Om den exakta referensen saknas behöver
   installationsägaren kontrollera Fortnox; ange inte en gissad referens.
4. Om bara uppladdningen hann bli klar och ingen bokföring skickades, välj
   **Granska samma förslag igen** och granska raderna på nytt. Detta skapar bara
   en ny granskningsknapp. Bokföring kräver ett nytt uttryckligt klick.
5. Har filen gått ut eller uppgifterna ändrats behöver du bifoga underlaget igen
   och förbereda ett nytt förslag. Kontrollera först att inget tidigare utfall
   fortfarande är okänt. Lyckade och osäkra verifikationer skickas aldrig om
   automatiskt av återupptagningsverktyget.

Färdiga tillfälliga filer rensas när inget kvarvarande förslag behöver dem;
resterande filer har samma tidsgräns som tidigare. Fortnox behåller sitt eget
underlag. Lokalt kvarvarande fel- och återhämtningsuppgifter är inga behörigheter
att göra nya anrop efter frånkoppling eller ändrad policy.


Testinstallationen kan förberedas med ett uttryckligen valt tillfälligt Node-relä
för filhämtningen; se [ENV-guiden](env.sv.md#förbered-filtransport-för-kvittoprovet).
Direkt filhämtning från Worker är inte tillgänglig. Reläet är en separat testhjälp,
aktiverar inte bokföring och ska stängas efter provet.

## Kontrollera återhämtningen i testinstallationen

Operatören kan använda `npm run test:receipts:status` med en privat konfiguration
och `RECEIPT_ACCEPTANCE_CONFIRM=test-companies-only`. Kommandot läser de två
tillåtna företagens valda batchar och jämför separata statusar och antal med det
förväntade läget. Det godkänner, laddar upp, länkar eller bokför ingenting.

Ett lyckat statusprov bevisar inte att Fortnox bara innehåller en verifikation.
Kontrollera även de exakta posterna i Fortnox före och efter återhämtning.
`npm run test:receipts:record` kontrollerar en ifylld manuell rapport, inte om
proven faktiskt utfördes. Ej genomförda prov ska ligga kvar som `not_run`.
Se [G08-provens exakta steg](../implementation/M04-G08-recovery.md) för mallar,
fel- och omstartsfall, källidentitet, begränsningar och kvarvarande manuella prov.

`npm run test:receipts:attachments` kan separat jämföra de auktoriserade
MCP-bilagornas identitet, typ, längd och SHA-256 med de ursprungliga lokala
testfilerna. Det anropar bara läsverktyg och gör inga fil- eller bokföringsändringar.
Det ersätter inte en faktisk nedladdningskontroll i ChatGPT. Mall och exakta steg
finns i [filoperationernas verifieringsunderlag](../implementation/M04-G06-files.md).
