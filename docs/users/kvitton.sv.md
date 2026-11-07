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
