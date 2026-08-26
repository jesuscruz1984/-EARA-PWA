import app from './agent-wrapper-v2.js';

const ORIGIN='https://jesuscruz1984.github.io';
function headers(origin,base){
  const h=new Headers(base||{});
  h.set('Content-Type','application/json; charset=utf-8');
  h.set('Cache-Control','no-store');
  h.set('Vary','Origin');
  if(origin===ORIGIN)h.set('Access-Control-Allow-Origin',ORIGIN);
  return h;
}
function isWeb(text,force){return !!force||/\b(search|look ?up|lookup|online|internet|web|find|current|latest|website|logo|company info|price|cost|news|today|near me|available|availability)\b/i.test(String(text||''))}
function normalizeForUi(input){
  let s=String(input||'').replace(/<\/?(?:a|div|span|p|br|strong|em|h[1-6])\b[^>]*>/gi,' ');
  s=s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,'**$1**\n$2');
  s=s.replace(/^\s*#{1,6}\s+(.+)$/gm,'**$1**');
  s=s.replace(/^\s*_{3,}\s*$/gm,'').replace(/^\s*\*{3,}\s*$/gm,'');
  s=s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g,'$1$2');
  s=s.replace(/\n{3,}/g,'\n\n').trim();
  return s;
}
function speechFrom(text){return String(text||'').replace(/https?:\/\/\S+/g,'').replace(/[\*_`#>|]+/g,' ').replace(/\s+/g,' ').trim().slice(0,420)}
function groundedMemory(memory){
  const rule='WEB GROUNDING REQUIREMENT: When searching for a company, person, product, place, or other named entity, do not choose a result from the name alone. Cross-check at least two strong identifiers such as official domain, city/address, phone, email, owner, or service category. If the identity is not verified, say that instead of guessing. Never fabricate contact details or URLs.';
  return `${String(memory||'')}\n\n${rule}`.slice(-22000);
}
export default {
  async fetch(request,env,ctx){
    const u=new URL(request.url);
    if(u.pathname!='/agent-chat'||request.method!=='POST')return app.fetch(request,env,ctx);
    const origin=request.headers.get('Origin')||'';
    let body=null;
    try{body=await request.clone().json()}catch(_){return app.fetch(request,env,ctx)}
    if(isWeb(body?.text,body?.forceWeb))body={...body,memory:groundedMemory(body?.memory)};
    const forwarded=new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(body)});
    const response=await app.fetch(forwarded,env,ctx);
    if(!response.ok)return response;
    const type=response.headers.get('Content-Type')||'';
    if(!/application\/json/i.test(type))return response;
    let data;try{data=await response.json()}catch(_){return response}
    if(!data?.pdfCreated&&typeof data?.text==='string'){
      data.text=normalizeForUi(data.text);
      if(!data.speech||/https?:\/\//.test(String(data.speech)))data.speech=speechFrom(data.text);
    }
    return new Response(JSON.stringify(data),{status:response.status,headers:headers(origin,response.headers)});
  }
};
