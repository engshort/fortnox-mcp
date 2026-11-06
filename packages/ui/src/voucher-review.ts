// MCP Apps host is trusted to keep result _meta outside model context. No credential,
// capability or voucher is persisted in browser storage or sent to model messages.
export const voucherReviewScript = `
const button=document.querySelector('#commit'), status=document.querySelector('#status'), refresh=document.querySelector('#refresh');
let proposal, capability, bridge=false, attempted=false, checking=false, sequence=0, disposition='pending';
const calls=new Map();
function rpc(method,params){return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{calls.delete(id);reject(new Error('timeout'));},15000);calls.set(id,{resolve,reject,timer});parent.postMessage({jsonrpc:'2.0',id,method,params},'*');});}
function reference(){return {company_id:proposal.company_id,proposal_id:proposal.proposal_id,proposal_hash:proposal.proposal_hash};}
function disable(message){button.disabled=true;status.textContent=message;}
function render(p){
  const details=document.querySelector('#details');details.replaceChildren();
  const v=p.voucher;
  for(const [name,value] of [['Företag',p.company_name+' ('+p.company_id+')'],['År',v.financial_year],['Datum',v.date],['Serie',v.series],['Beskrivning',v.description],['Valuta',v.currency],['Underlag','Inga filer bifogade; filkoppling ingår i ett senare steg.'],['Förslag',p.proposal_id],['Giltigt till',new Date(p.review_expires_at).toLocaleString('sv-SE',{timeZone:'Europe/Stockholm'})+' svensk tid']]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=name;dd.textContent=String(value);details.append(dt,dd);}
  const rows=document.querySelector('#rows');rows.replaceChildren();
  for(const r of v.rows){const tr=document.createElement('tr');for(const value of [r.account,r.debit,r.credit,r.cost_center||'',r.project||'',r.information||'']){const td=document.createElement('td');td.textContent=String(value);tr.append(td);}rows.append(tr);}
  document.querySelector('#totals').textContent='Debet: '+p.totals.debit+' · Kredit: '+p.totals.credit+' · Differens: '+p.totals.difference+' '+v.currency;
}
async function check(){if(!proposal||!bridge||checking)return;checking=true;disable('Kontrollerar beständig status…');try{const r=await rpc('tools/call',{name:'get_execution_status',arguments:reference()});const d=r.structuredContent;if(r.isError||!d||d.status!=='ok')throw new Error();const state=d.data.state;disposition=state;button.disabled=state!=='prepared'||!capability||attempted||Date.now()>=proposal.review_expires_at;status.textContent=state==='prepared'?'Granska företag, samtliga rader och totalsummor före bokföring.':state==='succeeded'?'Bokförd. Fortnox-referens: '+JSON.stringify(d.data.reference):state==='failed'?'Avvisad av leverantören.':'Utfallet är okänt eller förslaget har gått ut. Skicka inte igen; utred status.';}catch{disable('Status kan inte verifieras. Bokföring är avstängd.');}finally{checking=false;}}
refresh.onclick=check;
button.onclick=async()=>{if(button.disabled||attempted)return;attempted=true;disable('Skickar det granskade förslaget en gång…');try{const r=await rpc('tools/call',{name:'commit_reviewed_vouchers',arguments:{...reference(),capability}});capability=undefined;const d=r.structuredContent;if(r.isError||!d||d.status!=='ok')throw new Error();status.textContent=d.data.state==='succeeded'?'Bokförd. Fortnox-referens: '+JSON.stringify(d.data.reference):d.data.state==='failed'?'Fortnox avvisade bokföringen.':'Utfallet är okänt. Kontrollera status; skicka inte igen.';}catch{disable('Utfallet är okänt. Kontrollera status; skicka inte igen.');}};
addEventListener('message',event=>{if(event.source!==parent||!event.data||event.data.jsonrpc!=='2.0')return;const m=event.data;if(calls.has(m.id)){const c=calls.get(m.id);calls.delete(m.id);clearTimeout(c.timer);m.error?c.reject(new Error('rpc')):c.resolve(m.result);return;}if(m.method==='ui/notifications/tool-result'&&!attempted){const d=m.params?.structuredContent;const secret=m.params?._meta?.voucherReview;if(!d||d.status!=='ok'||!d.data?.voucher){disable('Saknar giltigt förslag.');return;}if(proposal){if(proposal.proposal_id!==d.data.proposal_id||proposal.proposal_hash!==d.data.proposal_hash){capability=undefined;disable('Förslaget ändrades. Förbered och granska på nytt.');}return;}proposal=Object.freeze(d.data);capability=secret?.capability;render(proposal);void check();}});
if(parent===window)disable('Klienten saknar verifierad granskningsvy.');else rpc('ui/initialize',{appInfo:{name:'Fortnox voucher review',version:'0.0.0'},appCapabilities:{},protocolVersion:'2026-01-26'}).then(()=>{bridge=true;parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized',params:{}},'*');void check();}).catch(()=>disable('Klientbryggan stöds inte.'));
setInterval(()=>{if(proposal&&!attempted&&disposition==='prepared'&&Date.now()>=proposal.review_expires_at)disable('Granskningen har gått ut. Förbered på nytt.');},1000);
`;
export async function voucherReviewHtml() {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(voucherReviewScript),
  );
  const hash = btoa(String.fromCharCode(...new Uint8Array(digest)));
  const style = `body{font:16px/1.5 system-ui,sans-serif;color:#152f3e;background:#fff;margin:0;padding:20px}main{max-width:900px;margin:auto}h1{font-size:1.5rem}dl{display:grid;grid-template-columns:minmax(112px,1fr) minmax(0,3fr);gap:8px}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}.rows{overflow-x:auto}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}th,td{padding:8px;text-align:left;border-bottom:1px solid #d9e2e8}td{overflow-wrap:anywhere}button{font:inherit;padding:10px 14px;margin:8px 8px 0 0;border:1px solid #254c63;border-radius:4px;background:#edf4f7;color:#152f3e;cursor:pointer}button:disabled{opacity:.5;cursor:default}button:focus-visible{outline:3px solid #0078b5;outline-offset:3px}#status{overflow-wrap:anywhere}`;
  const styleDigest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(style),
  );
  const styleHash = btoa(String.fromCharCode(...new Uint8Array(styleDigest)));
  return `<!doctype html><html lang="sv"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash}'; style-src 'sha256-${styleHash}'; base-uri 'none'; form-action 'none'"><title>Granska verifikation</title><style>${style}</style><main><h1>Granska verifikation</h1><p>Kontrollera hela förslaget. En balanserad verifikation bevisar inte rätt konto eller momsbehandling.</p><dl id="details"></dl><div class="rows"><table><thead><tr><th>Konto</th><th>Debet</th><th>Kredit</th><th>Kostnadsställe</th><th>Projekt</th><th>Information</th></tr></thead><tbody id="rows"></tbody></table></div><p id="totals"></p><button id="commit" disabled>Bokför granskat förslag</button><button id="refresh">Kontrollera status</button><p id="status" role="status" aria-live="polite">Väntar på förslag och verifierad klientbrygga.</p></main><script>${voucherReviewScript}</script></html>`;
}
