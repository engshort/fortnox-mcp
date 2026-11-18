# Administratörer, medarbetare och medlemssynkronisering

Funktionen är valfri och avstängd från början. Aktivera **Fleranvändarstöd** under
**Inställningar → Användare**. Aktivera även **Medlemssynkronisering via API** för
extern synkronisering. Operatörens `MULTI_USER_ENABLED` och
`MEMBERSHIP_PROVISIONING_ENABLED` är grundvärden. Se
[installationsinställningar](installationsinstallningar.sv.md). Detta fungerar
i både Node/Docker och Cloudflare-installationer.

## Lägg till en person

1. Öppna **Medlemmar** i administrationen.
2. Ange namn, e-post och roll. En administratör kan administrera hela installationen.
   En medarbetare får **Läsa** eller **Läsa och skriva** i uttryckligen valda företag.
3. Spara och skapa en inbjudningslänk. Förmedla den säkert till personen.
4. Personen öppnar länken och väljer eget lösenord. Länken gäller en gång i högst
   ett dygn. Ingen e-posttjänst krävs för detta flöde.

Installationsägaren behåller den yttersta kontrollen och kan inte tas bort eller
ersättas genom medlemsadministration eller integration. Företagets skrivskydd,
aktiverade program och granskningskrav gäller för alla användare.

Om personen redan har ett konto, använd **Koppla befintligt konto eller byt källa**.
Kopplingen kräver ett befintligt konto med exakt samma e-post. En integration får
inte automatiskt ta över ett konto genom att ange dess e-postadress.

Vid avbruten aktivering: kontrollera medlemsstatus och försök logga in med det
valda lösenordet. Om kontot skapades men kopplingen saknas kan administratören
koppla det uttryckligen. Om inget konto skapades, utfärda en ny inbjudan.

## Medarbetarens vy

Efter inloggning öppnas **Min åtkomst**. Där visas tilldelade företag, läs- och
skrivrättigheter, granskningskrav och adressen för anslutning av en egen AI-klient.
Logga in med ditt eget konto när klienten frågar och godkänn valda företag.
Ekonomiarbetet sker i AI-klienten genom befintliga MCP-verktyg.

Du kan återkalla dina klientgodkännanden och byta lösenord i vyn. När dina
rättigheter ändras behöver du godkänna klientåtkomsten på nytt. Om operatören har
aktiverat konto-e-post kan aktiva konton begära lösenordsåterställning via
**Återställ lösenord**. Inbjudningar skickas inte automatiskt som e-post.

## Synkronisera från ett annat system

Öppna **Integrationer** (sidan **Medlemsintegrationer**), skapa en källa och välj dess tillåtna företag.
Integrationsnyckeln visas bara vid utfärdandet. Förvara den i integrationssystemets
hemlighetslager, aldrig i ChatGPT, webbläsarlagring, ärenden eller versionshantering.
Du kan utfärda en ersättningsnyckel eller återkalla den befintliga.

Endast ägaren kan tillåta att en integration tillsätter administratörer. Sådana
administratörer får åtkomst till hela installationen. Övriga integrationer kan bara
hantera medarbetare inom källans valda företag. För att ändra företagstaket skapar
du en ny källa och flyttar medlemskapen uttryckligen.

Ett medlemskap styrs antingen lokalt eller av en integration. För integrationsstyrda
medlemskap ändras roller och tilldelningar i det externa systemet. Använd **Nödspärra**
för att omedelbart stoppa åtkomsten lokalt. En synk kan inte häva spärren.
Återkallad integrationsnyckel stoppar nya synkningar; redan skapade medlemmar finns
kvar. Avaktivera eller nödspärra dem separat när deras åtkomst ska upphöra.

M2X och andra system använder samma öppna
[integrationskontrakt](../contracts/membership-provisioning-v1.md). Ingen särskild
M2X-installation krävs. En oförändrad synk behåller användarens godkännande.
Användare som saknas i en synkomgång avaktiveras inte automatiskt; integrationen
måste skicka en uttrycklig avaktivering.

Efter återställning av en säkerhetskopia behöver ägaren granska och häva spärrar
för medlemmar samt utfärda nya integrationsnycklar. Gamla inbjudningar gäller inte
efter återställning eller krypteringsnyckelrotation. Ekonomiska skrivningar med okänt
utfall bevaras för avstämning.
