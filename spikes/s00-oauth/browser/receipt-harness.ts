// Synthetic UI bridge only. Product domain/provider behavior is tested separately.
import { createHash } from "node:crypto";
import { receiptReviewHtml } from "../../../packages/ui/src/receipt-review.js";

const fixture = {
  company_id: "00000000-0000-4000-8000-000000000001",
  company_name: "Syntetiskt företag A",
  batch_id: "00000000-0000-4000-8000-000000000002",
  batch_hash: "a".repeat(64),
  expires_at: Date.now() + 600000,
  execution_available: true,
  items: [1, 2].map((n) => ({
    item_id: `item-${n}`,
    file: {
      company_id: "00000000-0000-4000-8000-000000000001",
      workflow_id: "synthetic-workflow",
      file_id: `file-${n}`,
    },
    sha256: "b".repeat(64),
    state: "prepared",
    reason: null,
    next_action: "review_or_supply_input",
    duplicate_candidates: [],
    review_expires_at: Date.now() + 600000,
    steps: {
      upload: { state: "pending" },
      voucher: { state: "pending" },
      link: { state: "pending" },
    },
    voucher: {
      financial_year: 7,
      date: "2026-01-01",
      series: "A",
      currency: "SEK",
      description: `Syntetiskt kvitto ${n}`,
      rows: [
        { account: 1930, debit: "125.00", credit: "0.00" },
        { account: 4000, debit: "0.00", credit: "125.00" },
      ],
    },
    totals: { debit: "125.00", credit: "125.00", difference: "0.00" },
  })),
};
const hostScript = `
window.saved=${JSON.stringify(fixture)};
const counts={commits:0,repairs:0,renewals:0},caps={'item-1':'synthetic-cap-1','item-2':'synthetic-cap-2'};
let publicOnly=false,mode='normal';
const mount=()=>{const frame=document.createElement('iframe');frame.title='Receipt review';frame.sandbox='allow-scripts';frame.src='/receipt-widget';frame.style='width:100%;height:2800px;border:0';document.querySelector('main').replaceChildren(frame);};
const result=()=>{const items=window.saved.items;window.saved.counts={requested:items.length,completed:items.filter(i=>i.state==='completed').length,partial:items.filter(i=>i.state==='partial').length,failed:items.filter(i=>i.state==='failed').length,unknown:items.filter(i=>i.state==='outcome_unknown').length,needs_input:items.filter(i=>i.state==='needs_input').length,prepared:items.filter(i=>i.state==='prepared').length};return {status:'ok',data:window.saved};};
const notify=()=>document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:result(),_meta:publicOnly?{}:{receiptReview:{capabilities:caps}}}},'*');
window.receiptHarness={stats:()=>({...counts}),control:value=>{mode=value;},remount:()=>{publicOnly=true;mount();},changed:()=>{window.saved.batch_hash='c'.repeat(64);notify();}};
addEventListener('message',event=>{const frame=document.querySelector('iframe').contentWindow;if(event.source!==frame)return;const m=event.data;if(m?.jsonrpc!=='2.0')return;const reply=result=>frame.postMessage({jsonrpc:'2.0',id:m.id,result},'*');if(m.method==='ui/initialize')reply({});else if(m.method==='ui/notifications/initialized')notify();else if(m.method==='tools/call'){
const input=m.params.arguments,item=window.saved.items.find(i=>i.item_id===(input.item_id||input.item_ids?.[0]));
if(m.params.name==='get_receipt_batch')reply(mode==='status-error'?{isError:true}:{structuredContent:result()});
else if(m.params.name==='commit_reviewed_receipt_item'){counts.commits++;item.voucher=null;item.totals=null;item.steps.upload={state:'succeeded',reference:'synthetic-file'};item.steps.voucher={state:mode==='lost'?'outcome_unknown':'succeeded',reference:'synthetic-voucher'};item.steps.link={state:mode==='lost'?'pending':'failed',code:'HTTP_400'};item.state=mode==='lost'?'outcome_unknown':'partial';item.next_action=mode==='lost'?'reconcile_before_resending':'repair_link_only';if(mode!=='lost')reply({structuredContent:result()});}
else if(m.params.name==='resume_receipt_batch'){counts.repairs++;if(item.steps.voucher.state==='succeeded'){item.steps.link={state:'succeeded',reference:'synthetic-file'};item.state='completed';item.next_action='none';}reply({structuredContent:result()});}
else if(m.params.name==='review_receipt_item_again'){counts.renewals++;const fresh='synthetic-fresh-'+counts.renewals;item.review_expires_at=Date.now()+600000;item.state='prepared';reply({structuredContent:result(),_meta:{receiptReview:{capabilities:{[item.item_id]:fresh}}}});}
else reply({isError:true});
}});
mount();
`;
export const receiptHostCsp = `default-src 'none'; script-src 'sha256-${createHash("sha256").update(hostScript).digest("base64")}'; frame-src 'self'; style-src 'unsafe-inline'; base-uri 'none'`;
export const receiptHost = `<!doctype html><html lang="sv"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Synthetic receipt host</title><main></main><script>${hostScript}</script></html>`;
export const receiptWidget = await receiptReviewHtml();
