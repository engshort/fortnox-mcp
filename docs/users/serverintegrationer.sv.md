# Beständig åtkomst för Office och andra serverintegrationer

Installationsägaren kan godkänna en serverintegration för alla nuvarande och
framtida anslutna företag. Åtkomsten är fristående från medarbetares inloggningar
och fortsätter efter utloggning, omstart och längre driftavbrott.

1. Operatören aktiverar `INSTALLATION_ACCESS_ENABLED=true`, REST-API och
   REST-bryggan. Funktionen är avstängd från början.
2. Logga in som installationsägare och välj **AI-klienter → Hantera
   serverintegrationer**.
3. Ange applikationens namn. Ange gärna dess befintliga klient-ID för
   kundanslutning så att ekonomiprofilen blir förvald när nya kunder ansluts.
4. Läsning är standard. Markera separat om du även godkänner skrivning inom
   ekonomiprofilen för nuvarande och framtida företag.
5. Godkänn och spara klient-ID och klienthemlighet i applikationens skyddade
   hemlighetslager. Hemligheten kan inte hämtas igen; en förlorad hemlighet
   ersätts genom rotation.

Ekonomiprofilen omfattar bokföring, konton, referenser samt kund- och
leverantörsfakturor. Lön och filer ingår inte. Kunden godkänner ett servicekonto
hos Fortnox. En redan fungerande serviceanslutning med rätt behörigheter kan
återanvändas. Saknade behörigheter kräver kundens Fortnox-godkännande; ett problem
med Offices egen serverinloggning kräver inte att kunden ansluts på nytt.

Skrivning kan godkännas eller återkallas separat. Företagets skrivskydd och krav
på granskning av manuella verifikationer gäller fortfarande. Ett osäkert
skrivutfall måste utredas innan samma åtgärd skickas igen.

**Återkalla all åtkomst** spärrar integrationen och tar bort skrivgodkännandet.
**Rotera hemlighet och aktivera** ersätter serverhemligheten. Efter en återkallelse
behöver skrivning godkännas igen. Tidigare åtkomstbevis återaktiveras inte.

Listan över kundanslutningar visar sparad kontotyp och behörighetstäckning.
Den bevisar inte att ekonomin kan läsas just nu. Office behöver fortsatt
kontrollera läsbarhet och medarbetarnas kundbehörigheter. Den faktiska
fördröjningen för att upptäcka en återkallelse inne i Fortnox behöver verifieras
mot Fortnox; lokal frånkoppling spärrar företaget direkt.

Utvecklarens anropskontrakt finns i [installationsåtkomst](../contracts/installation-access.md).
