# Importera kontaktpersoner till Office

Kontaktimport är ett separat tillval som börjar avstängt. Installationsägaren
väljer företag och källor under **Serverintegrationer → Separat medgivande för
kontaktimport** och sparar medgivandet. Detta ger inte rätt att skriva löneuppgifter
eller att ge någon portalåtkomst i Office.

Anslut byråns eget Fortnox-företag separat genom det vanliga anslutningsflödet.
Office verifierar företagets identitet innan det används som byrå. Kundregistrets
kontaktperson hämtas från byråns företag; medarbetare från Lön hämtas från kundens
företag. Program och providerbehörigheter måste finnas för respektive källa.

En kund utan namngiven kontaktperson ger en tom lista. Saknad e-post hos en
namngiven person visas som saknad e-post. Fakturauppgifter används aldrig som
reserv. Flera kunder med samma exakta organisationsnummer måste rättas innan
importen kan genomföras.

Fortnox-användare kan hämtas bara om utvecklaråtkomst till den publicerade
integrationen finns. Listan omfattar endast den integrationens aktiva användare.
Otillgänglig källa, ofullständig hämtning och tillfälliga fel är inte tomma listor.

Återanslutning eller ändrade företagsbehörigheter kräver nytt kontaktmedgivande.
Ägaren kan återkalla kontaktimporten utan att återkalla ekonomiläsningen. Efter
ändrat medgivande behöver Office hämta ett nytt API-token. Lönebelopp, personnummer
och bankuppgifter lämnas inte till Office genom dessa kontaktvägar.

Se [integrationskontraktet](../contracts/office-contacts-v1.md) för konfiguration,
felkoder, paginering och det gemensamma kontraktsprovet.
