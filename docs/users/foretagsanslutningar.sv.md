# Säkra företagsanslutningar

Detta är produktimplementation under verifiering. Använd en separat testinstallation och uttryckligen tillåtna testföretag. Fortnox-operationer är avstängda tills deras klient- och providerevidens är godkänd.

## Ägare och inloggning

Installationsoperatören skapar en privat engångskod med tio minuters giltighet. Öppna `/setup`, ange koden, din e-postadress och ett lösenord på minst tolv tecken. Inga koder, lösenord eller Fortnox-hemligheter ska klistras in i AI-konversationen. Därefter används `/sign-in`; sessionen gäller högst ett dygn. Inloggningen begränsas gemensamt för installationen för att motverka upprepade försök.

Operatören kör `node --import tsx scripts/product-operator.ts .data/operator.json` med privat JSON innehållande `origin`, `secret`, `database`, `output` och `action` (`bootstrap` eller `reset`). Återställning kräver också ägarens `email`. Filen och utdata ska ligga utanför git med privata filrättigheter. Databasens migrationer ska redan vara applicerade. Hemligheter ska inte skickas som kommandoradsargument.

För D1: skapa motsvarande engångskod privat, beräkna SHA-256 och sätt en tio minuters sluttid. Importera en granskad privat SQL-instruktion som endast infogar posten `installation`/`owner` i `product_state` om den inte finns (`ON CONFLICT DO NOTHING`), med version 1 och värdet `{phase:"ready",ownerId:"",tokenHash:<hash>,expiresAt:<UTC-millis>}`. Kontrollera att exakt en post skapades. Återanvänd aldrig en befintlig installations ägare eller hemligheter. Produktionskonton ingår inte i testet.

Om bootstrap avbryts efter att koden förbrukats måste operatören utreda befintligt konto och tillstånd; starta inte om genom att radera ägaren. Glömt lösenord återställs genom en ny privat biblioteksgenererad kod, som gäller i tio minuter. Skicka den med det nya lösenordet till samma origins `/auth/reset-password`; koden kan användas en gång och tidigare adminsessioner återkallas. Ägaridentiteten bevaras. E-postutskick och offentlig registrering ingår inte.
