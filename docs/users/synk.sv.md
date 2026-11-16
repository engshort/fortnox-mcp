# Synka ekonomiska uppgifter till en extern tjänst

Fortnox MCP kan ge exempelvis M2X underlag för en lokal kopia av senaste läget:
huvudbok, reskontra och relevanta register för tillgängliga räkenskapsår.
Den externa tjänsten lagrar kopian och kör synkningen. Filer, kvitton,
versionshistorik och en ny backupfunktion ingår inte.

Funktionen är avstängd från början. Installationsansvarig behöver aktivera
`REST_API_ENABLED`, `REST_BRIDGE_ENABLED` och `REST_SYNC_ENABLED`, samt installera
en privat granskad API-katalog enligt [REST-bryggan](rest-brygga.sv.md).
Ingen rå Fortnox-specifikation följer med distributionen.

Registrera en separat serverklient för synkningen och godkänn API-läsning,
REST-bryggan, ekonomiska uppgifter och bakgrundsåtkomst för uttryckligen valda
företag. Använd resursen `/api/v1` och behörigheterna
`api:read api:bridge api:finance:read offline_access`. Befintlig MCP-inloggning
används fortsatt separat. Nya företag eller ändrade rättigheter kan kräva nytt
godkännande; en fungerande anslutning bevisar inte att alla data är tillgängliga.

I Node/Docker kan installationsansvarig även aktivera `FORTNOX_EVENTS_ENABLED`.
Fortnox MCP lyssnar då på ändringssignaler från Fortnox. M2X hämtar signalerna via
ett skyddat HTTPS-flöde och läser sedan aktuella uppgifter via REST-bryggan.
WebSocket är normal väg; reservpolling körs varje timme och fullavstämning varje
natt. Under normal belastning är målet uppdatering inom 60 sekunder.
Cloudflare-installationer får läshämtning men saknar realtidsadapter i denna version.

Synkmanifestet visar vilka resurser som är tillgängliga, saknade förutsättningar
och vad som faktiskt har verifierats. Betalningar och vissa register kan behöva
periodisk läsning. Händelser för verifikationer och konton begär tills vidare
avstämning eftersom Fortnox-händelsens år inte är verifierat som API:ets års-ID.

Vid första hämtningen sparar den externa tjänsten ändringsflödets startpunkt före
fullhämtning. Flödet sparar högst sju dagar eller 1 000 signaler per företag.
För gammal startpunkt, avbrott med otillräcklig historik eller återställning ger
ett uttryckligt krav på ny fullhämtning. En lucka visas aldrig som komplett synk.
Saknad behörighet eller en ofullständig lista får inte radera tidigare kopierade
uppgifter. Fortnox förblir systemet där ekonomiska ändringar görs.

Implementation och lokala tester är skilda från faktisk verifiering mot Fortnox
och M2X. Se [tekniskt kontrakt](../contracts/company-sync-v1.md) och
[verifieringsunderlag](../implementation/company-sync.md).
