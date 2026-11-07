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
