// Synthetic host extensions only. Actual ChatGPT support remains a separate gate.
import { createHash } from "node:crypto";
import { receiptPickerHtml } from "../../../packages/ui/src/receipt-picker.js";

const originals = [
  Buffer.from("synthetic png original"),
  Buffer.from("synthetic pdf original"),
];
const files = originals.map((b, i) => ({
  file_id: `00000000-0000-4000-8000-00000000000${i + 2}`,
  mime_type: i ? "application/pdf" : "image/png",
  bytes: b.length,
  sha256: createHash("sha256").update(b).digest("hex"),
  expires_at: Date.now() + 600000,
}));
const hostScript = [
  "const context={file_picker:true,company_id:'00000000-0000-4000-8000-000000000001',company_name:'Syntetiskt filföretag'};",
  "const stored={company_id:context.company_id,workflow_id:'00000000-0000-4000-8000-000000000004',files:" +
    JSON.stringify(files) +
    "};",
  "const blobs=" +
    JSON.stringify(originals.map((b) => b.toString("base64"))) +
    ";",
  "let saved,mode='normal';const counts={stages:0,reads:0,uploads:0,selects:0};",
  "const notify=()=>document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:context}},'*');",
  "window.fileHarness={stats:()=>({...counts}),control:v=>{mode=v;},state:()=>saved,remount:()=>{document.querySelector('iframe').src='/file-picker-widget?mode='+mode;}};",
  "addEventListener('message',event=>{const frame=document.querySelector('iframe').contentWindow;if(event.source!==frame)return;const m=event.data;if(m?.jsonrpc!=='2.0')return;const reply=result=>frame.postMessage({jsonrpc:'2.0',id:m.id,result},'*');if(m.method==='ui/initialize')reply({});else if(m.method==='ui/notifications/initialized')notify();else if(m.method==='tools/call'){if(m.params.name==='ingest_receipt_files'){counts.stages++;if(mode==='lost')return;reply({structuredContent:stored});}else if(m.params.name==='read_receipt_file'){counts.reads++;const i=stored.files.findIndex(f=>f.file_id===m.params.arguments.file_id);reply({content:[{type:'resource',resource:{uri:'receipt://files/'+context.company_id+'/'+stored.workflow_id+'/'+stored.files[i].file_id,mimeType:stored.files[i].mime_type,blob:mode==='corrupt'?'eA==':blobs[i]}}]});}else reply({isError:true});}});",
  "window.fileExtensions=(frame,variant)=>{const api={widgetState:saved,toolOutput:context,getFileDownloadUrl:async({fileId})=>({downloadUrl:'https://files.example.com/'+fileId+'?private-signature=synthetic'}),setWidgetState:v=>{saved=v;},uploadFile:async()=>{counts.uploads++;return {fileId:'upload-'+counts.uploads};}};if(variant!=='no-library')api.selectFiles=async()=>{counts.selects++;return [{fileId:'host-png',mimeType:'image/png'},{fileId:'host-pdf',mimeType:'application/pdf'}];};if(variant==='missing')delete api.getFileDownloadUrl;frame.openai=api;};",
].join("\n");
export const filePickerHostCsp =
  "default-src 'none'; script-src 'sha256-" +
  createHash("sha256").update(hostScript).digest("base64") +
  "'; frame-src 'self'; style-src 'unsafe-inline'; base-uri 'none'";
export const filePickerHost =
  '<!doctype html><html lang="sv"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Synthetic file picker host</title><main><iframe title="Receipt file picker" src="/file-picker-widget" style="width:100%;height:1500px;border:0" sandbox="allow-scripts allow-same-origin allow-downloads"></iframe></main><script>' +
  hostScript +
  "</script></html>";
export async function filePickerWidget(mode: string) {
  const html = await receiptPickerHtml();
  const injection = `parent.fileExtensions(window,${JSON.stringify(mode)});`;
  return html
    .replace(
      "script-src '",
      "script-src 'sha256-" +
        createHash("sha256").update(injection).digest("base64") +
        "' '",
    )
    .replace("<script>", `<script>${injection}</script><script>`);
}
