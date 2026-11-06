# Syntetiska klientprov

Det här är ett utvecklingsprov, inte en färdig Fortnox-anslutning.
Använd endast påhittade underlag. Inga verifikationer bokförs.

Filhämtningen har fått en separat [transportkorrigering](../implementation/S00-G03-transport-2026-11-06.md).
Cloudflares publika socketväg saknar den TLS-garanti som det tidigare provet
antog. Ett uttryckligt valt, autentiserat och kortlivat Node-hjälpprov kan därför
hämta filerna med kontrollerad DNS och TLS. Behörighet och krypterad lagring
ligger kvar i Worker. Hjälptjänsten är ingen permanent installation och direkt
filhämtning från Worker är fortfarande inte godkänd.

## Anslutning och granskning

Den isolerade provservern uppdaterades den 5 november 2026 med bevarad ägare,
hemligheter och databas. Det faktiska Chrome-provet har verifierat status,
tokenförnyelse för en ny klient och ett testgodkännande under begränsande CSP.
Efter omladdning kan sparade svar kräva **Läs in svaret igen** och vyn
**Försök igen**. Godkännandet återlästes som redan registrerat och gick inte
att skicka igen. Administrativ **Reload tools** provades, men fullständigt
klientstöd är fortfarande inte godkänt.

Om svaret på ett godkännande försvinner: använd **Kontrollera status**.
Skicka inte samma godkännande igen när utfallet är okänt. En saknad eller
utgången referens bevisar inte att en tidigare åtgärd misslyckades.

## Två filer

Filprovet är avstängt från början. Operatören kontrollerar först säker hämtning,
schemalagd rensning och klientstöd. `mcp:files` kräver ett nytt samtycke;
granskningsbehörigheten ger inte automatiskt filåtkomst.

Samtyckessidan beskriver de behörigheter som faktiskt begärs: läsning,
syntetisk granskning och/eller syntetiska filer. För filbehörigheten visas
krypterad lagring, ägar-/företagsbindning, 55 minuters giltighet och rensning.
En äldre OAuth-klient kan behöva ersättas med en separat privat testklient om
dess registrerade scopes saknar `mcp:files`. Ett `invalid_scope`-fel löses inte
genom att ändra gamla tokenposter eller lägga till filbehörighet utan samtycke.

Välj högst två syntetiska PNG-, JPEG- eller enkla okomprimerade PDF-filer,
högst **1 MiB vardera på Workers**, 5 MiB på Node och tio sidor per PDF.
Worker-gränsen sänktes efter faktisk mätning av minnesbehovet. PNG måste vara 8-bitars utan
interlacing; bilder får ha högst två miljoner pixlar. Lösenordsskyddade eller
komprimerade PDF:er stöds inte i detta begränsade prov. Hämtningen får ta högst
15 sekunder. En bild som syns i konversationen innebär inte automatiskt att
klienten lämnar över dess bytes till servern.

Under ett uttryckligt aktiverat, kort operatörsprov kan diagnostiken visa enbart
filvärdens DNS-namn för ett behörigt anrop. Signerade URL-parametrar, sökvägar
och filidentifierare loggas inte. Diagnostiken lägger inte till några tillåtna
värdar och stängs av efter provet.

Jämför filstorlek och SHA-256 med originalen och prova varje returnerad fil.
Referenserna hör till provets ägare/företag och gäller i högst 55 minuter.
Underlagen lagras krypterat och rensas av bakgrundskörningen. Vid driftavbrott
kan fysisk rensning fördröjas, men utgångna referenser ger inte åtkomst.
Ny hämtning efter expiry kräver ny filinput.

`synthetic-receipt` och `synthetic-voucher` är testreferenser, inte poster i
Fortnox. Filanropen i Chrome gav först `FILE_URL_DENIED`. Med exakt den
observerade filvärden tillåten gav de `FILE_FETCH_FAILED` vid svarsläsning;
inga filbytes lagrades. Filprovet är åter avstängt och inga filvärdar är tillåtna. Faktiskt
filstöd i ChatGPT är ännu inte verifierat.
[Tekniskt underlag och kvarstående prov](../implementation/S00-files-evidence.md).
