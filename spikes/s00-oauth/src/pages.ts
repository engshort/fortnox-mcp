export function page(
  kind: "home" | "sign-in" | "consent",
  review = false,
  files = false,
) {
  const title =
    kind === "sign-in"
      ? "Logga in för OAuth-testet"
      : kind === "consent"
        ? "Godkänn testanslutningen"
        : "Fortnox MCP – OAuth-test";
  const body =
    kind === "sign-in"
      ? `<p>Använd engångskoden från din lokala operatör. Koden gäller i fem minuter och kan användas en gång.</p><form id="login"><label>Engångskod<input name="token" type="password" autocomplete="off" required></label><button>Logga in</button></form>`
      : kind === "consent"
        ? `<p>Klienten får läsa en fast teststatus. ${review ? "Granskningsbehörigheten låter klienten förbereda och registrera syntetiska testgodkännanden i en inbäddad vy. " : ""}${files ? "Filbehörigheten låter klienten hämta valda syntetiska filer och läsa tillbaka dem. Tillfälliga bytes lagras krypterat och knyts till provets ägare och testföretag. Filreferenserna gäller i 55 minuter och är inte offentliga. Bytes rensas normalt inom en timme; vid driftavbrott sker rensningen när driften återupptas. " : ""}Inga Fortnox-uppgifter eller ekonomiska åtgärder är tillgängliga.</p><p id="client"></p><p id="scopes"></p><button id="allow">${files ? "Godkänn begärda testbehörigheter" : review ? "Godkänn syntetiskt granskningsprov" : "Godkänn läsning av teststatus"}</button> <button id="deny">Avbryt</button>`
        : `<p>Isolerad S00-prototyp. Fortnox är avstängt.</p><p>MCP-adress: <code>/mcp</code>. Verktygsanrop kräver OAuth. Protokoll- och verktygsmetadata är offentliga.</p><p><a href="/sign-in">Logga in med engångskod</a></p>`;
  return `<!doctype html><html lang="sv"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><link rel="stylesheet" href="/style.css"><main><h1>${title}</h1>${body}<p role="status" id="status"></p><p><a href="https://github.com/alex-engvall/fortnox-mcp">Källkod (AGPL-3.0)</a> · Experiment, endast syntetiska data.</p></main><script src="/page.js" defer></script></html>`;
}

export const style =
  "body{font:18px system-ui;background:#f6f7f9;color:#182535;margin:0}main{max-width:680px;margin:8vh auto;padding:32px;background:white;border-radius:16px}h1{font-size:30px}label{display:block}input{display:block;padding:12px;width:90%;margin:12px 0}button{padding:12px 18px;margin:8px 0;cursor:pointer;background:#173f67;color:white;border:0;border-radius:6px}a{color:#173f67}";

// Only the library-signed OAuth query is forwarded. No credential is put in a
// URL, localStorage, tool result, log, or external script request.
export const script = `
const q=location.search.slice(1), status=document.querySelector('#status');
async function post(path,body){
 const r=await fetch('/auth/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const data=await r.json(); if(!r.ok)throw Error('Begäran misslyckades. Kontrollera koden eller starta om anslutningen.');return data;
}
document.querySelector('#login')?.addEventListener('submit',async e=>{e.preventDefault();try{
 const form=new FormData(e.target); const r=await post('one-time-token/verify',{token:form.get('token'),...(q?{oauth_query:q}:{})});
 e.target.reset(); if(q){location.assign(r.url||('/auth/oauth2/authorize?'+q));}
 else{status.textContent='Inloggad. Fortsätt anslutningen i ChatGPT.';}
 }catch(e){status.textContent=e.message;}});
if(location.pathname==='/consent'){
 const p=new URLSearchParams(q);document.querySelector('#client').textContent='Klient-ID: '+p.get('client_id');document.querySelector('#scopes').textContent='Begärd behörighet: '+p.get('scope');
 for(const [id,accept] of [['allow',true],['deny',false]])document.querySelector('#'+id).onclick=async()=>{try{const r=await post('oauth2/consent',{accept,oauth_query:q});if(r.url)location.assign(r.url);}catch(e){status.textContent=e.message;}};
}`;
