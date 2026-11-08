# Docker-installation och drift

Milstolpe 5 byggs för Linux med Docker Compose bakom en befintlig Nginx.
Slutlig klient-/Fortnox-acceptans återstår; använd inga produktionskonton.

## Gemensam Node-applikation

Applikationen använder samma kod och SQLite oavsett processhantering.
`HOST` är normalt `127.0.0.1`, `PORT` är `8787` och `DATA_DIR` är `.data`.
Ett uttryckligt `PRODUCT_DATABASE` överstyr databasens standardsökväg.
Behåll krypteringsnycklarna när du startar om eller uppgraderar.

Node kan läsa `AUTH_SECRET_FILE`, `CREDENTIAL_KEYS_FILE` och
`FORTNOX_CLIENT_SECRET_FILE` från privata filer. Ange inte samtidigt värdet
direkt och med `_FILE`. Inga hemligheter ska byggas in i ett image eller skickas
till ChatGPT. Engångskoden för första ägaren ligger i den privata datakatalogen.

`NODE_PROXY_MODE=nginx` kräver HTTPS, exakt publik värdadress och en Nginx som
skriver över proxyheaders. Exponera inte Node-porten direkt på Internet.
Läget `none` är standard för lokal utveckling.

## Installation

Du behöver en Linuxserver (amd64), Docker Compose, en domän och befintlig Nginx
med HTTPS-certifikat. Bygg imaget från en granskad Git-version enligt
[installationskommandona](../deployment-linux.md#installation). Initieringen skapar
egna nycklar i `deploy/docker/.private`; katalogen ska ha behörighet 0700 och
får inte skickas till Git eller support. Compose monterar nycklarna skrivskyddat.

Anpassa Nginx-exemplet till din domän och kontrollera det med `nginx -t` innan
du använder serverns vanliga rutin för omladdning. Node-porten publiceras bara
på 127.0.0.1:3000. Öppna därefter `/setup` på din HTTPS-adress.

Hämta engångskoden privat med `docker compose cp` från containerns
`/data/bootstrap-code.txt`. Öppna filen lokalt och ta bort kopian efter användning.
Koden gäller i tio minuter och ska aldrig klistras in i AI-konversationen.

Volymen innehåller beständig SQLite-data. Behåll både volym och nycklar vid
uppgradering. Kör inte `down --volumes` på en installation du vill behålla.
Se [leveransstatus](../implementation/M05-delivery.md) för vad som faktiskt testats.

## Kommande installationssätt

Steg 3 blir direkt Node-installation med systemd: samma applikation, men en
installerare måste hantera Node, systemanvändare, rättigheter och uppdateringar.
Steg 4 blir APT med .deb-paket och ett signerat paketarkiv. Dessa steg dokumenteras
nu och är inte implementerade eller tillgängliga installationsalternativ.
