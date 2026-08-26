import app from './agent-wrapper-v3.js';

const NEMOTRON='@cf/nvidia/nemotron-3-120b-a12b';
const GLM='@cf/zai-org/glm-4.7-flash';
const ORIGIN='https://jesuscruz1984.github.io';
function outText(r){
  if(typeof r==='string')return r.trim();
  if(r?.response)return String(r.response).trim();
  if(r?.output_text)return String(r.output_text).trim();
  const c=r?.choices?.[0]?.message?.content;
  if(typeof c==='string')return c.trim();
  if(Array.isArray(c))return c.map(x=>x?.text||x?.content||'').filter(Boolean).join('\n').trim();
  return '';
}
function clean(s){return String(s||'').replace(/<\/?(?:a|div|span|p|br|strong|em|h[1-6])\b[^>]*>/gi,' ').replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,'**$1**\n$2').replace(/^\s*#{1,6}\s+(.+)$/gm,'**$1**').replace(/\n{3,}/g,'\n\n').trim()}
function speech(s){return String(s||'').replace(/https?:\/\/\S+/g,'').replace(/[\*_`#>|]+/g,' ').replace(/\s+/g,' ').trim().slice(0,420)}
function isWeb(t,f){return !!f||/\b(search|look ?up|lookup|online|internet|web|find|current|latest|website|logo|company info|price|cost|news|today|near me|available|availability|buy|purchase|in stock)\b/i.test(String(t||''))}
function cors(origin,base){const h=new Headers(base||{});h.set('Content-Type','application/json; charset=utf-8');h.set('Cache-Control','no-store');if(origin===ORIGIN)h.set('Access-Control-Allow-Origin',ORIGIN);return h}
async function runHosted(env,system,user,max=1200){
  let last=null;
  for(const model of [NEMOTRON,GLM]){
    try{
      const r=await env.AI.run(model,{messages:[{role:'system',content:system},{role:'user',content:user}],max_completion_tokens:max,temperature:0.2});
      const text=clean(outText(r));
      if(text)return {text,model};
    }catch(e){last=e}
  }
  throw last||new Error('Hosted fallback unavailable');
}
async function search(env,q){
  if(!env.TAVILY_API_KEY)return null;
  const r=await fetch('https://api.tavily.com/search',{method:'POST',headers:{'Authorization':`Bearer ${env.TAVILY_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({query:String(q||'').slice(0,1800),search_depth:'advanced',max_results:7,include_answer:false,include_raw_content:false,include_images:false})});
  if(!r.ok)return null;return r.json();
}
function evidence(d){return (d?.results||[]).slice(0,6).map((x,i)=>`SOURCE ${i+1}\nTitle: ${x.title||''}\nURL: ${x.url||''}\nEvidence: ${String(x.content||'').slice(0,1000)}`).join('\n\n')}
async function improveWeb(env,body,prior){
  try{
    const d=await search(env,body?.text);const ev=evidence(d);if(!ev)return prior;
    const system='You are Agent 1.0. Answer using ONLY the supplied current web evidence. Never invent names, addresses, phone numbers, emails, websites, prices, dates, specifications, or company identities. For a named company/person/place/product, cross-check at least two identifying signals when possible. If identity is uncertain, say so. Be concise, professional and useful. Do not output HTML. Do not expose reasoning.';
    const user=`USER REQUEST:\n${body?.text||''}\n\nCURRENT WEB EVIDENCE:\n${ev}`;
    const rr=await runHosted(env,system,user,1100);const sources=(d?.results||[]).slice(0,5).map(x=>x.url).filter(Boolean);
    const text=sources.length?`${rr.text}\n\n**Sources**\n${sources.join('\n')}`:rr.text;
    return {...prior,text,speech:speech(text),model:rr.model,route:'hosted-grounded-web',agentFallback:true,webUsed:true,grounded:true,webProvider:'Tavily + hosted reasoning'};
  }catch(_){return prior}
}
async function improveChat(env,body,prior){
  if(body?.image||body?.file)return prior;
  try{
    const memory=String(body?.memory||'').slice(-18000);
    const system='You are Agent 1.0, a highly capable general-purpose personal AI assistant. Answer like a polished modern assistant: understand follow-ups, be accurate, practical, professional, and natural. Accomplish the user goal rather than narrating process. Preserve useful details, names and numbers from conversation context. Never fabricate current facts or pretend you searched the web when you did not. Never expose hidden reasoning. Keep raw URLs out of spoken summaries.';
    const user=[memory?`RECENT CONVERSATION:\n${memory}`:'',`USER REQUEST:\n${body?.text||''}`].filter(Boolean).join('\n\n');
    const rr=await runHosted(env,system,user,1400);
    return {...prior,text:rr.text,speech:speech(rr.text),model:rr.model,route:'enhanced-backup',agentFallback:true,enhancedBackup:true};
  }catch(_){return prior}
}
export default{
  async fetch(request,env,ctx){
    const u=new URL(request.url);if(u.pathname!='/agent-chat'||request.method!=='POST')return app.fetch(request,env,ctx);
    let body=null;try{body=await request.clone().json()}catch(_){return app.fetch(request,env,ctx)}
    const response=await app.fetch(new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(body)}),env,ctx);
    if(!response.ok||!/application\/json/i.test(response.headers.get('Content-Type')||''))return response;
    let data;try{data=await response.json()}catch(_){return response}
    if(data?.pdfCreated)return new Response(JSON.stringify(data),{status:response.status,headers:cors(request.headers.get('Origin')||'',response.headers)});
    if(data?.route==='grounded-web-fallback')data=await improveWeb(env,body,data);
    else if(data?.agentFallback&&!isWeb(body?.text,body?.forceWeb))data=await improveChat(env,body,data);
    return new Response(JSON.stringify(data),{status:response.status,headers:cors(request.headers.get('Origin')||'',response.headers)});
  }
};
