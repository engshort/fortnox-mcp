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

Installationspaket, fulla driftsteg och deras verifiering läggs till i nästa
leverans. Se [leveransstatus](../implementation/M05-delivery.md).
