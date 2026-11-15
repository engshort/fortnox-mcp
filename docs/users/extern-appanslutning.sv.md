# Anslut företag från en extern applikation

Funktionen är avsedd för registrerade appar med egen backend, exempelvis en app
med ett kundregister. Appen startar **Anslut företag**, du loggar vid behov in som
installationsägare, väljer eller ansluter ett Fortnox-företag och godkänner sedan
appens företagsåtkomst. Du återvänder automatiskt till appen. Appen ska kontrollera
det verifierade resultatet och läsa företagsprofil/status innan den visar anslutet.
En lyckad återkomst eller ett Fortnox-medgivande räcker inte ensamt.

## Förbered installationen en gång

Installationsägare och Fortnox-integrationen måste redan finnas. Operatören lägger
appens exakta HTTPS-callback i `MCP_REDIRECT_URIS`, registrerar en separat
OAuth-klient för appens backend med `client_secret_basic` och anger dess ID i
`EXTERNAL_APP_ONBOARDING_CLIENT_IDS` (JSON-lista). Aktivera med
`EXTERNAL_APP_ONBOARDING_ENABLED=true`. Funktionen är annars avstängd.
Klienthemligheten hanteras privat av appens backend. Per företag ska användaren
inte behöva kopiera tekniska ID:n, koder eller tokens.

Detta backendkrav gäller bara det nya appinitierade flödet. Befintliga MCP-klienter
och installationens vanliga fristående företagsanslutning fungerar som tidigare.
Appens administratör blir inte automatiskt installationsägare.

## Företagsval och återanslutning

Återanvänd en befintlig verifierad anslutning när rätt företag redan finns.
När du lägger till företag B visar godkännandet även tidigare avsedd, aktuell
åtkomst till A. Kontrollera hela urvalet. Ett nytt godkännande ersätter appens
föregående tokens; andra klienter påverkas inte. Återanslutning ska behålla samma
företag och historik. Ett annat Fortnox-företag får inte ersätta det avsedda.

Anslutningen aktiverar inga ekonomiska program och ändrar inte företagets sparade
skrivskydd eller verifikationspolicy. Nya företag börjar med skrivskydd och
`review_required`. Appens första åtkomst är `mcp:read` samt valfritt
`offline_access` för fortsatt användning.

## Om flödet avbryts

Försöket gäller i 30 minuter. Appen kan återuppta det inom 24 timmar från starten.
Har företaget redan verifierats används samma företag vid ett nytt uttryckligt
appgodkännande. Anslut inte Fortnox på nytt på chans. En förlorad kod eller ett
osäkert tokenutbyte får inte skickas igen blint.

Vid okänt providerutfall krävs ägarens kontroll. Ett oanvänt, inte påbörjat
kodutbyte kan avbrytas i det guidade flödet. En pågående utväxling kan inte
återställas som om den misslyckats. Rätt befintligt företag kan uttryckligen väljas
och verifieras; annars behöver operatören utreda läget. Efter utgången inloggning
kan samma installationsägare logga in igen och uttryckligen fortsätta granskningen.
Guiden väntar om ett kodutbyte fortfarande pågår och skickar aldrig koden igen. Utgånget eller gallrat
försök ger ett tydligt fel och ska hanteras genom appens återupptagning.

Återställning från backup eller nyckelrotation ogiltigförklarar gamla
onboardingfortsättningar. Företagen finns kvar: starta ett nytt försök och välj den
befintliga anslutningen. Skicka aldrig ägarlösenord, providerhemligheter eller råa
callbackadresser med koder i chatt eller supportloggar.

Lokala syntetiska tester och faktisk gemensam M2X-/Fortnox-acceptans redovisas
separat i [implementationsevidensen](../implementation/external-company-onboarding.md).
