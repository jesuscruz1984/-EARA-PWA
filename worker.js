export default {
  async fetch(request, env) {
    const allowedOrigin=env.ALLOWED_ORIGIN||"https://jesuscruz1984.github.io";
    const origin=request.headers.get("Origin")||"";
    const cors={"Access-Control-Allow-Origin":origin===allowedOrigin?origin:allowedOrigin,"Access-Control-Allow-Methods":"GET, POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type","Vary":"Origin"};
    if(request.method==="OPTIONS")return new Response(null,{headers:cors});
    const url=new URL(request.url);
    if(!env.AI)return j({error:"Cloudflare Workers AI binding is not configured."},500,cors);
    try{
      if(url.pathname==="/health")return j({ok:true,reasoning:"@cf/openai/gpt-oss-120b",vision:"@cf/meta/llama-3.2-11b-vision-instruct",tts:"@cf/deepgram/aura-1",webPrimary:"Tavily",tavilyConfigured:!!env.TAVILY_API_KEY,webSecondary:"openai/gpt-5.5 via Cloudflare AI Gateway"},200,cors);
      if(url.pathname==="/web-test"&&request.method==="GET"){
        if(!env.TAVILY_API_KEY)return j({ok:false,error:"TAVILY_API_KEY is not configured."},503,cors);
        try{const data=await tavilySearchRaw(env.TAVILY_API_KEY,"OpenAI official website");return j({ok:true,provider:"Tavily",results:(data.results||[]).slice(0,2).map(x=>({title:x.title,url:x.url})),usage:data.usage||null},200,cors)}catch(e){return j({ok:false,provider:"Tavily",error:String(e?.message||e)},502,cors)}
      }
      if(url.pathname==="/accept-llama"&&request.method==="GET")return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>EARA Vision Setup</title><style>body{font-family:-apple-system,sans-serif;background:#07111d;color:#fff;padding:28px;max-width:700px;margin:auto}button{width:100%;font-size:20px;font-weight:700;padding:18px;border:0;border-radius:14px;background:#43d2a0;color:#06130e}</style><h1>EARA Vision Setup</h1><form method="post" action="/accept-llama"><button type="submit">I Agree — Enable EARA Vision</button></form>`,{headers:{"Content-Type":"text/html; charset=utf-8"}});
      if(url.pathname==="/accept-llama"&&request.method==="POST"){const result=await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct",{prompt:"agree"});return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,sans-serif;background:#07111d;color:#fff;padding:32px;text-align:center}a{color:#57b8ff}</style><h1>✅ EARA Vision Enabled</h1><a href="https://jesuscruz1984.github.io/">Open EARA</a><pre>${escapeHtml(JSON.stringify(result))}</pre>`,{headers:{"Content-Type":"text/html; charset=utf-8"}})}
      if(url.pathname==="/transcribe"&&request.method==="POST"){const incoming=await request.formData(),audio=incoming.get("audio");if(!audio)return j({error:"Missing audio"},400,cors);const bytes=[...new Uint8Array(await audio.arrayBuffer())];const result=await env.AI.run("@cf/openai/whisper-large-v3-turbo",{audio:bytes});return j({text:String(result?.text||result?.result?.text||"").trim()},200,cors)}
      if(url.pathname==="/tts"&&request.method==="POST"){
        const {text,speaker}=await request.json();if(!text)return j({error:"Missing text"},400,cors);
        const spoken=makeSpeech(text);if(!spoken)return j({error:"Nothing to speak"},400,cors);
        const allowed=new Set(["angus","asteria","arcas","orion","orpheus","athena","luna","zeus","perseus","helios","hera","stella"]);
        const voice=allowed.has(String(speaker||"").toLowerCase())?String(speaker).toLowerCase():"asteria";
        const raw=await env.AI.run("@cf/deepgram/aura-1",{text:spoken.slice(0,220),speaker:voice,encoding:"mp3"},{returnRawResponse:true});
        let audio;if(raw instanceof Response)audio=await raw.arrayBuffer();else if(raw instanceof ArrayBuffer)audio=raw;else if(ArrayBuffer.isView(raw))audio=raw.buffer;else if(raw?.audio&&typeof raw.audio==="string")return j({audio:raw.audio,mime:"audio/mpeg",speaker:voice,spoken},200,cors);
        if(!audio)return j({error:"Aura returned no playable audio."},500,cors);
        return j({audio:bytesToBase64(new Uint8Array(audio)),mime:"audio/mpeg",speaker:voice,spoken},200,cors)
      }
      if(url.pathname==="/chat"&&request.method==="POST"){
        const {text,image,memory,personality}=await request.json();if(!text)return j({error:"Missing text"},400,cors);
        const styles={helpful:"Be broadly helpful, practical, warm, and clear.",concise:"Be extremely concise and action-oriented. Prefer short direct answers.",expert:"Act as a rigorous expert analyst. Explain technical details precisely and call out uncertainty.",companion:"Be friendly, conversational, supportive, and natural while still useful.",fieldtech:"Think like an experienced field technician. Prioritize troubleshooting steps, safety, equipment details, and practical fixes.",observer:"Act like a curious observational agent. Notice useful visual/environmental details and connect them to prior memory."};
        const style=styles[personality]||styles.helpful;
        const safeMemory=String(memory||"(no stored memory yet)").replace(/EARA:.*(?:large language model|cannot visually|can't visually|cannot see|can't see|one-way communication|text-based inputs only).*/gi,"EARA: [obsolete capability statement ignored]");
        const hasImage=typeof image==="string"&&image.startsWith("data:image/");
        const wantsWeb=isWebIntent(text);
        const system=`You are EARA, an active real-time camera, voice, memory and live-web research assistant. You are talking with the user right now. The microphone pipeline transcribes the user's speech, so you can hear and answer them through EARA. ${style} Never claim you are only a text model, one-way tool, unable to converse, or fundamentally unable to search online. When live web results are supplied, use them as current evidence. Put useful detail, prices, links and supporting information in the on-screen answer. EARA creates a separate short spoken summary, so do not remove useful on-screen details. If URLs are available, include the most useful direct links.\n\nEARA MEMORY:\n${safeMemory}`;
        let scene="";
        if(hasImage){
          const vision=await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct",{messages:[{role:"system",content:"Inspect the attached live camera frame carefully. Describe concrete visible objects, text, brands, model numbers, colors and actions. Do not discuss AI limitations. If a product may need to be found online, prioritize identifying marks, label text, model numbers and brand names."},{role:"user",content:`User request: ${text}`}],image,max_tokens:320,temperature:0.2});
          scene=extract(vision);
        }
        if(wantsWeb){
          const query=buildSearchQuery(text,scene);
          let tavilyError="";
          if(env.TAVILY_API_KEY){
            try{
              const tr=await tavilySearch(env.TAVILY_API_KEY,query);
              if(tr){
                const synth=await env.AI.run("@cf/openai/gpt-oss-120b",{messages:[{role:"system",content:system+"\nYou have fresh Tavily web-search results below. Use them as the source of truth. Give a useful direct answer, include current prices when present, and include the best direct URLs. Never say you cannot search online."},{role:"user",content:`USER REQUEST:\n${text}\n\n${scene?`CAMERA OBSERVATION:\n${scene}\n\n`:""}CURRENT TAVILY WEB RESULTS:\n${tr}`}],max_tokens:650,temperature:0.3});
                const a=extract(synth);if(a)return chatReply(a,{visionUsed:hasImage,webUsed:true,webProvider:"Tavily",model:"gpt-oss-120b+tavily"},cors)
              }
            }catch(e){tavilyError=String(e?.message||e)}
          }else tavilyError="TAVILY_API_KEY missing";
          let gatewayError="";
          try{
            const searchPrompt=`${system}\n\n${scene?`CURRENT CAMERA OBSERVATION:\n${scene}\n\n`:""}USER REQUEST:\n${text}\n\nUse live web search. Give current, concrete results. For products, provide the closest exact match, price when visible, seller/store name, and direct URLs. Never say you cannot browse.`;
            const web=await env.AI.run("openai/gpt-5.5",{input:searchPrompt,max_output_tokens:700,tools:[{type:"web_search_preview"}],reasoning:{effort:"low"}},{gateway:{id:env.AI_GATEWAY_ID||"default"}});
            const webAnswer=extract(web);if(webAnswer)return chatReply(webAnswer,{visionUsed:hasImage,webUsed:true,webProvider:"Cloudflare AI Gateway",model:"openai/gpt-5.5"},cors)
          }catch(e){gatewayError=String(e?.message||e)}
          const fallback=await env.AI.run("@cf/openai/gpt-oss-120b",{messages:[{role:"system",content:system},{role:"user",content:`${scene?`Current camera observation: ${scene}\n\n`:""}${text}\n\nA live-search connection failed on this specific request. Do not say you are unable to search the internet. Give the best useful answer you can from the camera observation and known information, and say only: \"Live search hit a temporary connection issue. Try that search again.\"`}],max_tokens:420,temperature:0.35});
          return chatReply(extract(fallback)||"Live search hit a temporary connection issue. Try that search again.",{visionUsed:hasImage,webUsed:false,webError:{tavily:tavilyError,gateway:gatewayError},model:"@cf/openai/gpt-oss-120b"},cors)
        }
        const userContext=`${scene?`CURRENT LIVE CAMERA OBSERVATION:\n${scene}\n\n`:""}USER:\n${text}`;
        const result=await env.AI.run("@cf/openai/gpt-oss-120b",{messages:[{role:"system",content:system+(hasImage?"\nA live-camera observation is included in the user message. Treat it as what EARA currently sees and answer from it when relevant.":"")},{role:"user",content:userContext}],max_tokens:520,temperature:0.4});
        let answer=extract(result);
        if(hasImage&&isFalseVisionRefusal(answer))answer=scene||"I received the live camera frame, but the visual description failed on this request.";
        return chatReply(answer||"I couldn't generate a response.",{visionUsed:hasImage,webUsed:false,model:"@cf/openai/gpt-oss-120b"},cors)
      }
      return j({ok:true,service:"EARA Cloudflare AI backend",reasoning:"GPT-OSS 120B",vision:"Llama 3.2 Vision",voice:"Deepgram Aura",web:"Tavily primary"},200,cors)
    }catch(e){return j({error:String(e?.message||e)},500,cors)}
  }
};
function chatReply(text,meta,cors){const full=String(text||"").trim();return j({text:full,speech:makeSpeech(full,!!meta?.webUsed),...meta},200,cors)}
function makeSpeech(input,web=false){
  const raw=String(input||"").trim();if(!raw)return "";
  const hadLink=/(?:https?:\/\/|www\.)/i.test(raw);
  const price=(raw.match(/\$\s?\d[\d,]*(?:\.\d{1,2})?/)||[])[0];
  let clean=raw.replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)]+\)/gi,"$1").replace(/(?:https?:\/\/|www\.)\S+/gi,"").replace(/[\*_`#>|]+/g," ").replace(/^\s*\d+[.)]\s*/gm,"").replace(/^\s*[-•]\s*/gm,"").replace(/\s+/g," ").trim();
  let first=(clean.match(/[^.!?]+[.!?]+|[^.!?]+$/)||[clean])[0].trim().replace(/[:;,\-\s]+$/,".");
  if(!first||first.length<3)first="I found the information.";
  if(first.length>135){first=first.slice(0,135);const cut=first.lastIndexOf(" ");if(cut>90)first=first.slice(0,cut);first=first.replace(/[,;:\-\s]+$/,".")}
  if((web||hadLink)&&price&&!first.includes(price))first+=` One price I found is ${price.replace(/\s+/g,"")}.`;
  if(web||hadLink)first+=" The links and full details are on screen.";
  return first.replace(/\s+/g," ").trim().slice(0,210);
}
function isWebIntent(s){return /\b(search|search for|look up|lookup|find|locate|show me where|online|internet|web|amazon|ebay|walmart|best buy|buy|purchase|order|price|cost|deal|seller|store|where can i get|where can i buy|where do i get|link|website|latest|current|today|news|weather|stock price|score|near me|open now|available|availability)\b/i.test(String(s||""))}
function buildSearchQuery(text,scene){const t=String(text||"").trim();const s=String(scene||"").trim();return s?`${t}\nIdentify and search for this exact item using these visible details: ${s}`:t}
async function tavilySearchRaw(key,query){const r=await fetch("https://api.tavily.com/search",{method:"POST",headers:{"Authorization":`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({query,search_depth:"basic",max_results:6,include_answer:false,include_raw_content:false,include_images:false,safe_search:true})});const text=await r.text();if(!r.ok)throw new Error(`Tavily ${r.status}: ${text.slice(0,300)}`);return JSON.parse(text)}
async function tavilySearch(key,query){const d=await tavilySearchRaw(key,query);return (d.results||[]).map((x,i)=>`${i+1}. ${x.title||"Result"}\n${x.url||""}\n${x.content||""}`).join("\n\n")}
function isFalseVisionRefusal(s){return /(?:can(?:not|'t) (?:visually )?(?:see|observe|view|access)|do not have (?:the )?capability to (?:visually )?(?:see|observe)|text-based inputs only|large language model.*(?:see|visual))/i.test(String(s||""))}
function bytesToBase64(bytes){let out="";const step=0x8000;for(let i=0;i<bytes.length;i+=step)out+=String.fromCharCode(...bytes.subarray(i,i+step));return btoa(out)}
function extract(d){if(typeof d==="string")return d.trim();if(d?.output_text)return String(d.output_text).trim();if(d?.response)return String(d.response).trim();if(d?.result?.response)return String(d.result.response).trim();if(d?.text)return String(d.text).trim();if(d?.choices?.[0]?.message?.content)return String(d.choices[0].message.content).trim();if(Array.isArray(d?.output)){const parts=[];for(const item of d.output){for(const c of item?.content||[]){if(c?.text)parts.push(c.text)}}if(parts.length)return parts.join("\n").trim()}return ""}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}
function j(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:{...headers,"Content-Type":"application/json","Cache-Control":"no-store"}})}
