# Syntetiska klientprov

Det här är ett utvecklingsprov, inte en färdig Fortnox-anslutning.
Använd endast påhittade underlag. Inga verifikationer bokförs.

## Anslutning och granskning

Den isolerade provservern uppdaterades den 5 november 2026 med bevarad ägare,
hemligheter och databas. Sparade svar, administrativ **Reload tools** och
granskningsvyn behöver fortfarande verifieras i det avsedda ChatGPT-kontot.
En fungerande serverstatus räcker inte för att förklara klientstödet färdigt.

Om svaret på ett godkännande försvinner: använd **Kontrollera status**.
Skicka inte samma godkännande igen när utfallet är okänt. En saknad eller
utgången referens bevisar inte att en tidigare åtgärd misslyckades.

## Två filer

Filprovet är avstängt från början. Operatören kontrollerar först säker hämtning,
schemalagd rensning och klientstöd. `mcp:files` kräver ett nytt samtycke;
granskningsbehörigheten ger inte automatiskt filåtkomst.

Välj högst två syntetiska PNG-, JPEG- eller enkla okomprimerade PDF-filer,
högst **1 MiB vardera på Workers**, 5 MiB på Node och tio sidor per PDF.
Worker-gränsen sänktes efter faktisk mätning av minnesbehovet. PNG måste vara 8-bitars utan
interlacing; bilder får ha högst två miljoner pixlar. Lösenordsskyddade eller
komprimerade PDF:er stöds inte i detta begränsade prov. Hämtningen får ta högst
15 sekunder. En bild som syns i konversationen innebär inte automatiskt att
klienten lämnar över dess bytes till servern.

Jämför filstorlek och SHA-256 med originalen och prova varje returnerad fil.
Referenserna hör till provets ägare/företag och gäller i högst 55 minuter.
Underlagen lagras krypterat och rensas av bakgrundskörningen. Vid driftavbrott
kan fysisk rensning fördröjas, men utgångna referenser ger inte åtkomst.
Ny hämtning efter expiry kräver ny filinput.

`synthetic-receipt` och `synthetic-voucher` är testreferenser, inte poster i
Fortnox. Faktiskt filstöd i ChatGPT är ännu inte verifierat.
[Tekniskt underlag och kvarstående prov](../implementation/S00-files-evidence.md).
