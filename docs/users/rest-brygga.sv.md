# Använd Fortnox MCP som REST-brygga

Ägare och administratörer kan aktivera REST-API och REST-brygga under
**Inställningar → Integrationer**, utan omstart. Serverflaggorna nedan är
grundvärden. Ägaren kan också installera ett granskat katalogpaket där. Se
[installationsinställningar](installationsinstallningar.sv.md).

En annan applikation kan använda Fortnox eget anropsformat genom Fortnox MCP.
Exempelvis går ett fakturaanrop till
`/api/v1/companies/{företags-id}/fortnox/3/invoices`. Fortnox MCP sköter
anslutningen och kontrollerar företag, behörigheter, skrivskydd och bokföringspolicy.

Installationsägaren aktiverar både `REST_API_ENABLED=true` och
`REST_BRIDGE_ENABLED=true`. Bryggan är avstängd från början. Ägaren behöver också
installera en privat granskad API-katalog enligt
[utvecklarkontraktet](../contracts/bridge.md). Verktyget
`npm run prepare:bridge-catalog -- /privat/openapi.json /privat/granskning.json`
skapar ett underlag där alla operationer är avstängda tills de har granskats.
Underlaget ska inte läggas i Git eller publiceras.

Applikationen använder REST-API:ts vanliga OAuth-inloggning. Du väljer uttryckligen
vilka företag den får använda. Bryggan kräver ett nytt medgivande med `api:bridge`,
även för läsning. Äldre läsåtkomst utökas inte automatiskt. Skrivning kräver dessutom
`api:write`; filhantering kräver `api:files`. Ekonomisk läsning kräver även
`api:finance:read`. Gamla medgivanden får inte dessa rättigheter automatiskt.

Utvecklaren frågar `/api/v1/companies/{id}/bridge/operations` vilka anrop som är
tillgängliga. Hela den importerade katalogen kan visas, men nödvändiga licenser,
Fortnox-behörigheter och validering måste finnas innan ett anrop kan köras.
Specialistfunktioner kan kräva annan autentisering och vara otillgängliga.
Nya Fortnox-endpoints kräver en uppdaterad katalog.

Varje handling ska ha en unik `Idempotency-Key` som applikationen sparar före
anropet. Även ett GET-anrop kan skicka exempelvis en faktura. Vid avbrott ska
applikationen kontrollera den sparade exekveringens status. Ett osäkert resultat
betyder att åtgärden kan ha utförts. Skicka inte samma handling med en ny nyckel.
Bryggan sparar begränsad statusinformation, inte kopior av företagets bokföring.

Granskningskravet för manuell bokföring gäller fortsatt. Om företaget har
`review_required` används den befintliga betrodda granskningsvägen. Bryggan kan
inte godkänna sitt eget underlag eller ändra företagets policy.

Denna leverans har separata lokala tester. Det innebär inte att alla Fortnox
operationer är provade i verkligheten. Katalogimport, aktivering och faktisk
providerverifiering redovisas var för sig.


### Läs originalunderlag

En separat serverklient kan godkännas för läsning av filkopplingar och original i
ett känt företag. Ägaren behöver granska och installera de aktuella
filoperationerna i katalogen. Original kan läsas med en gräns på 20 MiB för
godkända filvägar och typer. Prova med ett auktoriserat testföretag och jämför
hämtade filer med Fortnox filexport före införande.
[Behörigheter och anrop](../contracts/bridge.md#voucher-originals-for-background-consumers)
