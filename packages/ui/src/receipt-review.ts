// Conforming MCP Apps host keeps capabilities in UI-only _meta. No browser
// persistence, arbitrary network access, model approval or replacement rows.
export const receiptReviewScript = `
let batch,capabilities={},bridge=false,seq=0,checking=false,locked=false;
const pending=new Map(),attempted=new Set();
const root=document.querySelector('#items'),status=document.querySelector('#status');
function rpc(method,params){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(new Error('timeout'));},15000);pending.set(id,{resolve,reject,timer});parent.postMessage({jsonrpc:'2.0',id,method,params},'*');});}
function reference(){return {company_id:batch.company_id,batch_id:batch.batch_id,batch_hash:batch.batch_hash};}
function text(tag,value,parent){const e=document.createElement(tag);e.textContent=String(value);parent.append(e);return e;}
function disable(message){for(const b of root.querySelectorAll('button[data-commit]'))b.disabled=true;status.textContent=message;}
function render(view){
 root.replaceChildren();text('p',view.company_name+' ('+view.company_id+')',root);
 for(const item of view.items){const section=document.createElement('section');section.dataset.item=item.item_id;root.append(section);
 text('h2','Kvitto '+item.item_id,section);text('p','Underlag '+item.file.file_id+' · SHA-256 '+(item.sha256||'saknas'),section);
 text('p','Status: '+item.state+(item.reason?' · '+item.reason:''),section);
 text('p','Dubblettkandidater: '+(item.duplicate_candidates.join(', ')||'inga'),section);
 if(item.voucher){const v=item.voucher;text('p','Räkenskapsår '+v.financial_year+' · '+v.date+' · Serie '+v.series+' · '+v.currency,section);text('p',v.description,section);
 const table=document.createElement('table'),head=document.createElement('tr');for(const h of ['Konto','Debet','Kredit','Kostnadsställe','Projekt','Information'])text('th',h,head);table.append(head);
 for(const row of v.rows){const tr=document.createElement('tr');for(const value of [row.account,row.debit,row.credit,row.cost_center||'',row.project||'',row.information||''])text('td',value,tr);table.append(tr);}const scroll=document.createElement('div');scroll.className='rows';scroll.append(table);section.append(scroll);
 text('p','Debet: '+item.totals.debit+' · Kredit: '+item.totals.credit+' · Differens: '+item.totals.difference+' '+v.currency,section);}
 const preview=text('button','Visa underlag',section);preview.onclick=async()=>{preview.disabled=true;try{const r=await rpc('tools/call',{name:'read_receipt_file',arguments:item.file});const resource=r.content?.find(c=>c.type==='resource')?.resource;if(r.isError||!resource?.blob)throw new Error();if(['image/png','image/jpeg'].includes(resource.mimeType)){const img=document.createElement('img');img.alt='Kvitto '+item.file.file_id;img.src='data:'+resource.mimeType+';base64,'+resource.blob;section.append(img);}else text('p','PDF-underlaget har hämtats autentiserat. Läs originalet i klientens filvy före granskning.',section);}catch{text('p','Underlaget kunde inte verifieras. Bokför inte.',section);for(const b of section.querySelectorAll('button[data-commit]'))b.disabled=true;}};
 const button=text('button','Bokför detta granskade kvitto',section);button.dataset.commit=item.item_id;
 button.disabled=locked||!view.execution_available||item.state!=='prepared'||!capabilities[item.item_id]||attempted.has(item.item_id)||Date.now()>=item.review_expires_at;
 if(!view.execution_available)text('p','Bokföring är avstängd tills klient- och providerkraven är verifierade.',section);
 button.onclick=async()=>{if(button.disabled||attempted.has(item.item_id))return;attempted.add(item.item_id);button.disabled=true;status.textContent='Skickar endast detta oförändrade kvitto en gång…';const capability=capabilities[item.item_id];delete capabilities[item.item_id];try{const r=await rpc('tools/call',{name:'commit_reviewed_receipt_item',arguments:{...reference(),item_id:item.item_id,capability}});if(r.isError||r.structuredContent?.status!=='ok')throw new Error();status.textContent='Resultat: '+r.structuredContent.data.state+'. Kontrollera status före fler åtgärder.';}catch{status.textContent='Utfallet är okänt. Kontrollera beständig status; skicka inte samma bokföring igen.';}};
 }
}
async function check(){if(!batch||!bridge||checking||locked)return;checking=true;disable('Kontrollerar beständig status…');try{const r=await rpc('tools/call',{name:'get_receipt_batch',arguments:reference()});const d=r.structuredContent;if(r.isError||d?.status!=='ok'||d.data.batch_hash!==batch.batch_hash)throw new Error();render(d.data);status.textContent='Granska varje underlag, företag och samtliga rader separat. Ett kvitto får inte balansera ett annat.';}catch{disable('Status kan inte verifieras. Bokföring är avstängd.');}finally{checking=false;}}
document.querySelector('#refresh').onclick=check;
addEventListener('message',event=>{if(event.source!==parent||event.data?.jsonrpc!=='2.0')return;const m=event.data;if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error('rpc')):p.resolve(m.result);return;}if(m.method==='ui/notifications/tool-result'){const d=m.params?.structuredContent;if(d?.status!=='ok'||!d.data?.items)return;const view=d.data;if(batch){if(batch.batch_id!==view.batch_id||batch.batch_hash!==view.batch_hash){locked=true;capabilities={};disable('Urval eller förslag ändrades. Ny granskning krävs.');}return;}batch=Object.freeze(view);capabilities={...(m.params?._meta?.receiptReview?.capabilities||{})};void check();}});
if(parent===window)disable('Klienten saknar verifierad granskningsvy.');else rpc('ui/initialize',{appInfo:{name:'Fortnox receipt review',version:'0.0.0'},appCapabilities:{},protocolVersion:'2026-01-26'}).then(()=>{bridge=true;parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized',params:{}},'*');void check();}).catch(()=>disable('Klientbryggan stöds inte.'));
setInterval(()=>{for(const button of root.querySelectorAll('button[data-commit]')){const item=batch?.items.find(i=>i.item_id===button.dataset.commit);if(!item||Date.now()>=item.review_expires_at||Date.now()>=batch.expires_at)button.disabled=true;}},1000);
`;
export async function receiptReviewHtml() {
  const style =
    "body{font:16px/1.5 system-ui,sans-serif;color:#152f3e;margin:0;padding:20px;background:#fff}main{max-width:960px;margin:auto}section{border:1px solid #d9e2e8;padding:16px;margin:16px 0;border-radius:6px}p,h2{overflow-wrap:anywhere}h1{font-size:1.5rem}h2{font-size:1.15rem}.rows{overflow-x:auto}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}th,td{padding:8px;text-align:left;border-bottom:1px solid #d9e2e8}button{font:inherit;padding:10px;margin:8px;border:1px solid #254c63;border-radius:4px;color:#152f3e;background:#edf4f7}button:disabled{opacity:.5}button:focus-visible{outline:3px solid #0078b5}img{display:block;max-width:100%;height:auto}";
  const hash = async (s: string) =>
    btoa(
      String.fromCharCode(
        ...new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
        ),
      ),
    );
  return `<!doctype html><html lang="sv"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${await hash(receiptReviewScript)}'; style-src 'sha256-${await hash(style)}'; img-src data:; base-uri 'none'; form-action 'none'"><title>Granska kvitton</title><style>${style}</style><main><h1>Granska kvitton var för sig</h1><p>Kontrollera originalunderlaget. Servern hittar inte på konto, moms eller saknade belopp. Godkänn endast den post du faktiskt har granskat.</p><div id="items"></div><button id="refresh">Kontrollera status</button><p id="status" role="status" aria-live="polite">Väntar på förslag och verifierad klientbrygga.</p></main><script>${receiptReviewScript}</script></html>`;
}
