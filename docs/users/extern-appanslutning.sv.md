# Anslut företag från en extern applikation

Extern appanslutning och listorna över tillåtna backendklienter kan hanteras av
ägare och administratörer under **Inställningar → Integrationer**, utan omstart.
Miljövariablerna för dessa val är grundvärden. Callback-adresser hanteras
fortfarande av operatören. Se [installationsinställningar](installationsinstallningar.sv.md).

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

Guiden använder samma logotyp, färger och formspråk som administrationen, med ett
fokuserat sidhuvud. **Anslut ett nytt företag** visas först: välj anslutningstyp
och tryck på **Fortsätt till Fortnox**. Befintliga företag visas under som ett
alternativ, med namn, organisationsnummer och knappen **Välj**. Kontrollera det
valda företaget i appgodkännandet. Efter en lyckad nyanslutning är just det nya
företaget automatiskt valt och guiden går direkt till appgodkännandet. Samma sak
gäller när du väljer ett befintligt företag. Granska åtkomsten och godkänn den
uttryckligen innan du återvänder till appen.

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

Medan en åtgärd skickas spärras sidans övriga knappar. Om svaret saknas väljer du
**Kontrollera sparat läge** för att läsa det sparade utfallet. Det skickar inte
åtgärden igen. Om inloggningen gått ut loggar du in och återkommer till samma
försök. För en utgången länk som finns kvar väljer du **Fortsätt i [appens namn]**.
Appen får då begära en ny länk med nya säkerhetsbindningar. Granska och godkänn
åtkomsten igen; ett redan verifierat företag finns kvar. En gallrad länk visar
lokal vägledning: öppna anslutningen från appen och välj det befintliga företaget.

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

Lokala syntetiska tester, prov med verklig M2X-backend och kvarvarande Fortnox-prov
redovisas separat i [implementationsevidensen](../implementation/external-company-onboarding.md).


## Beständig åtkomst för appens backend

Installationsoperatören kan ange appens förregistrerade konfidentiella klient-ID
i `MCP_OFFLINE_CLIENT_IDS`. Standardvärdet är `[]`, alltså avstängt. Med ditt
uttryckliga godkännande av fortsatt åtkomst gäller appens förnyelsetoken då i
30 dagar från senaste lyckade förnyelse. Appen kan förnya åtkomsten även när du
är utloggad eller anslutningsförsöket har gallrats. Korta åtkomsttoken, ditt
företagsurval och företagets policy gäller fortfarande. Vanliga klienter behåller
sin befintliga giltighet.

Appen behöver spara ersättningsparet säkert och förnya innan giltigheten går ut.
Bevara databas, krypteringsnycklar och klientregistrering vid omstart. Ett osäkert
utbyte ska inte skickas igen; appadministratören får då godkänna åtkomsten på nytt
till samma företag. Installationsägaren kan återkalla åtkomsten. Appen ansvarar
fortsatt för medarbetarnas aktuella kundbehörigheter.

Ändringen är lokalt syntetiskt testad. Verklig M2X/Fortnox-åtkomst över en helg och
aktivering i drift verifieras separat; ingen driftinställning ändras av koden.
