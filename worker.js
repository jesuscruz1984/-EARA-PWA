export default {
  async fetch(request, env) {
    const allowedOrigin=env.ALLOWED_ORIGIN||"https://jesuscruz1984.github.io";
    const origin=request.headers.get("Origin")||"";
    const cors={"Access-Control-Allow-Origin":origin===allowedOrigin?origin:allowedOrigin,"Access-Control-Allow-Methods":"GET, POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type","Vary":"Origin"};
    if(request.method==="OPTIONS")return new Response(null,{headers:cors});
    const url=new URL(request.url);
    if(!env.AI)return j({error:"Cloudflare Workers AI binding is not configured."},500,cors);
    try{
      if(url.pathname==="/health")return j({ok:true,mode:"Auto Smart",normal:"@cf/zai-org/glm-4.7-flash",deep:"@cf/openai/gpt-oss-120b",vision:"@cf/meta/llama-3.2-11b-vision-instruct on demand",tts:"free device voice by default; @cf/deepgram/aura-1 optional",webPrimary:"Tavily",tavilyConfigured:!!env.TAVILY_API_KEY},200,cors);
      if(url.pathname==="/web-test"&&request.method==="GET"){
        if(!env.TAVILY_API_KEY)return j({ok:false,error:"TAVILY_API_KEY is not configured."},503,cors);
        try{const data=await tavilySearchRaw(env.TAVILY_API_KEY,"OpenAI official website");return j({ok:true,provider:"Tavily",results:(data.results||[]).slice(0,2).map(x=>({title:x.title,url:x.url})),usage:data.usage||null},200,cors)}catch(e){return j({ok:false,provider:"Tavily",error:String(e?.message||e)},502,cors)}
      }
      if(url.pathname==="/accept-llama"&&request.method==="GET")return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>EARA Vision Setup</title><style>body{font-family:-apple-system,sans-serif;background:#07111d;color:#fff;padding:28px;max-width:700px;margin:auto}button{width:100%;font-size:20px;font-weight:700;padding:18px;border:0;border-radius:14px;background:#43d2a0;color:#06130e}</style><h1>EARA Vision Setup</h1><form method="post" action="/accept-llama"><button type="submit">I Agree — Enable EARA Vision</button></form>`,{headers:{"Content-Type":"text/html; charset=utf-8"}});
      if(url.pathname==="/accept-llama"&&request.method==="POST"){const result=await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct",{prompt:"agree"});return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,sans-serif;background:#07111d;color:#fff;padding:32px;text-align:center}a{color:#57b8ff}</style><h1>✅ EARA Vision Enabled</h1><a href="https://jesuscruz1984.github.io/">Open EARA</a><pre>${escapeHtml(JSON.stringify(result))}</pre>`,{headers:{"Content-Type":"text/html; charset=utf-8"}})}
      if(url.pathname==="/transcribe"&&request.method==="POST"){
        const incoming=await request.formData(),audio=incoming.get("audio");if(!audio)return j({error:"Missing audio"},400,cors);
        const bytes=[...new Uint8Array(await audio.arrayBuffer())];
        try{const result=await env.AI.run("@cf/openai/whisper-large-v3-turbo",{audio:bytes});return j({text:String(result?.text||result?.result?.text||"").trim()},200,cors)}catch(e){if(isQuotaError(e))return j({error:"Daily Cloudflare AI allowance reached. Speech transcription will resume after the daily reset."},429,cors);throw e}
      }
      if(url.pathname==="/tts"&&request.method==="POST"){
        const {text,speaker}=await request.json();if(!text)return j({error:"Missing text"},400,cors);
        const spoken=makeSpeech(text);if(!spoken)return j({error:"Nothing to speak"},400,cors);
        const allowed=new Set(["angus","asteria","arcas","orion","orpheus","athena","luna","zeus","perseus","helios","hera","stella"]);
        const voice=allowed.has(String(speaker||"").toLowerCase())?String(speaker).toLowerCase():"asteria";
        try{
          const raw=await env.AI.run("@cf/deepgram/aura-1",{text:spoken.slice(0,220),speaker:voice,encoding:"mp3"},{returnRawResponse:true});
          let audio;if(raw instanceof Response)audio=await raw.arrayBuffer();else if(raw instanceof ArrayBuffer)audio=raw;else if(ArrayBuffer.isView(raw))audio=raw.buffer;else if(raw?.audio&&typeof raw.audio==="string")return j({audio:raw.audio,mime:"audio/mpeg",speaker:voice,spoken},200,cors);
          if(!audio)return j({error:"Aura returned no playable audio."},500,cors);
          return j({audio:bytesToBase64(new Uint8Array(audio)),mime:"audio/mpeg",speaker:voice,spoken},200,cors)
        }catch(e){if(isQuotaError(e))return j({error:"Premium voice daily Cloudflare allowance reached. Select a FREE iPhone voice."},429,cors);throw e}
      }
      if(url.pathname==="/chat"&&request.method==="POST"){
        const {text,image,memory,personality,source}=await request.json();if(!text)return j({error:"Missing text"},400,cors);
        const styles={helpful:"Be broadly helpful, practical, warm, and clear.",concise:"Be extremely concise and action-oriented. Prefer short direct answers.",expert:"Act as a rigorous expert analyst. Explain technical details precisely and call out uncertainty.",companion:"Be friendly, conversational, supportive, and natural while still useful.",fieldtech:"Think like an experienced field technician. Prioritize troubleshooting steps, safety, equipment details, and practical fixes.",observer:"Act like a curious observational agent. Notice useful visual/environmental details and connect them to prior memory."};
        const style=styles[personality]||styles.helpful;
        const safeMemory=String(memory||"(no stored memory yet)").replace(/EARA:.*(?:large language model|cannot visually|can't visually|cannot see|can't see|one-way communication|text-based inputs only).*/gi,"EARA: [obsolete capability statement ignored]").slice(-7500);
        const hasImage=typeof image==="string"&&image.startsWith("data:image/");
        const wantsWeb=isWebIntent(text);
        const wantsDeep=isDeepIntent(text,personality);
        const system=`You are EARA, an active real-time voice, memory, camera and live-web assistant. You are talking with the user right now. ${style} Never claim you are only a text model, one-way tool, unable to converse, unable to see when a visual observation is provided, or fundamentally unable to search online. Be accurate and practical. Put useful detail, prices, links and supporting information in the on-screen answer; EARA separately creates a short spoken summary. Use memory only when relevant.\n\nEARA MEMORY:\n${safeMemory}`;
        let scene="",visionError="";
        if(hasImage){
          try{
            const kind=source==="screen"?"shared screen":"live camera frame";
            const vision=await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct",{messages:[{role:"system",content:`Inspect the attached ${kind} carefully. Identify the important visible object, text, brand, model number, color, state, warning, screen content or action needed for the user's request. Be concise and factual. Do not discuss AI limitations.`},{role:"user",content:`User request: ${text}`}],image,max_tokens:180,temperature:0.15});
            scene=extract(vision);
          }catch(e){visionError=String(e?.message||e);if(!isQuotaError(e))throw e}
        }
        if(wantsWeb){
          const query=buildSearchQuery(text,scene);
          let tavilyError="",gatewayError="";
          if(env.TAVILY_API_KEY){
            try{
              const data=await tavilySearchRaw(env.TAVILY_API_KEY,query);
              const tr=formatTavilyResults(data);
              if(tr){
                try{
                  const synth=await env.AI.run("@cf/zai-org/glm-4.7-flash",{messages:[{role:"system",content:system+"\nYou have fresh Tavily web results below. Use them as current evidence. Answer directly, include current prices when present, and include the best direct URLs. Never say you cannot search online."},{role:"user",content:`USER REQUEST:\n${text}\n\n${scene?`VISUAL OBSERVATION:\n${scene}\n\n`:""}CURRENT TAVILY RESULTS:\n${tr}`}],max_tokens:420,temperature:0.25});
                  const a=extract(synth);if(a)return chatReply(a,{visionUsed:hasImage&&!!scene,webUsed:true,webProvider:"Tavily",model:"@cf/zai-org/glm-4.7-flash",modelMode:"auto",visionError:visionError||undefined},cors)
                }catch(e){
                  if(!isQuotaError(e))tavilyError="AI summary: "+String(e?.message||e);
                  const direct=formatTavilyDirect(data,text,!!scene,visionError);
                  return chatReply(direct,{visionUsed:hasImage&&!!scene,webUsed:true,webProvider:"Tavily direct",model:"Tavily",modelMode:"web-direct",aiLimited:isQuotaError(e),visionError:visionError||undefined},cors)
                }
              }
            }catch(e){tavilyError=String(e?.message||e)}
          }else tavilyError="TAVILY_API_KEY missing";
          try{
            const searchPrompt=`${system}\n\n${scene?`VISUAL OBSERVATION:\n${scene}\n\n`:""}USER REQUEST:\n${text}\n\nUse live web search. Give current concrete results with useful direct URLs. Never say you cannot browse.`;
            const web=await env.AI.run("openai/gpt-5.5",{input:searchPrompt,max_output_tokens:550,tools:[{type:"web_search_preview"}],reasoning:{effort:"low"}},{gateway:{id:env.AI_GATEWAY_ID||"default"}});
            const webAnswer=extract(web);if(webAnswer)return chatReply(webAnswer,{visionUsed:hasImage&&!!scene,webUsed:true,webProvider:"Cloudflare AI Gateway",model:"openai/gpt-5.5",modelMode:"web",visionError:visionError||undefined},cors)
          }catch(e){gatewayError=String(e?.message||e)}
          const msg=visionError&&isQuotaError(visionError)?"I can still search the web, but today's Cloudflare vision allowance is used up, so I could not identify the item from the camera. Try a text description or wait for the daily reset.":"Live search hit a temporary connection issue. Try that search again.";
          return chatReply(msg,{visionUsed:false,webUsed:false,webError:{tavily:tavilyError,gateway:gatewayError},modelMode:"fallback"},cors)
        }
        if(hasImage&&visionError&&isQuotaError(visionError))return chatReply("Today's Cloudflare AI allowance is used up, so I can't analyze a new camera frame until the daily reset. Normal web searches that don't need the camera can still use Tavily.",{visionUsed:false,webUsed:false,aiLimited:true,modelMode:"limit"},cors);
        const userContext=`${scene?`CURRENT ${source==="screen"?"SHARED SCREEN":"CAMERA"} OBSERVATION:\n${scene}\n\n`:""}USER:\n${text}`;
        const primary=wantsDeep?"@cf/openai/gpt-oss-120b":"@cf/zai-org/glm-4.7-flash";
        try{
          const result=await env.AI.run(primary,{messages:[{role:"system",content:system+(scene?"\nA current visual observation is included. Treat it as what EARA sees now.":"")},{role:"user",content:userContext}],max_tokens:wantsDeep?500:320,temperature:wantsDeep?0.35:0.45});
          let answer=extract(result);if(scene&&isFalseVisionRefusal(answer))answer=scene||answer;
          return chatReply(answer||"I couldn't generate a response.",{visionUsed:hasImage&&!!scene,webUsed:false,model:primary,modelMode:wantsDeep?"deep":"auto"},cors)
        }catch(e){
          if(wantsDeep&&!isQuotaError(e)){
            try{const light=await env.AI.run("@cf/zai-org/glm-4.7-flash",{messages:[{role:"system",content:system},{role:"user",content:userContext}],max_tokens:320,temperature:0.4});return chatReply(extract(light)||"I couldn't generate a response.",{visionUsed:hasImage&&!!scene,webUsed:false,model:"@cf/zai-org/glm-4.7-flash",modelMode:"auto-fallback"},cors)}catch(e2){e=e2}
          }
          if(isQuotaError(e))return chatReply("Today's free Cloudflare AI allowance has been used. EARA's free iPhone voice and Tavily web search remain available; normal AI conversation resumes after Cloudflare's daily reset.",{visionUsed:false,webUsed:false,aiLimited:true,modelMode:"limit"},cors);
          throw e
        }
      }
      return j({ok:true,service:"EARA Auto Smart backend",normal:"GLM-4.7-Flash",deep:"GPT-OSS 120B",vision:"on demand",voice:"device free / Aura optional",web:"Tavily primary"},200,cors)
    }catch(e){return j({error:String(e?.message||e)},500,cors)}
  }
};
function chatReply(text,meta,cors){const full=String(text||"").trim();return j({text:full,speech:makeSpeech(full,!!meta?.webUsed),...meta},200,cors)}
function makeSpeech(input,web=false){const raw=String(input||"").trim();if(!raw)return "";const hadLink=/(?:https?:\/\/|www\.)/i.test(raw);const price=(raw.match(/\$\s?\d[\d,]*(?:\.\d{1,2})?/)||[])[0];let clean=raw.replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)]+\)/gi,"$1").replace(/(?:https?:\/\/|www\.)\S+/gi,"").replace(/[\*_`#>|]+/g," ").replace(/^\s*\d+[.)]\s*/gm,"").replace(/^\s*[-•]\s*/gm,"").replace(/\s+/g," ").trim();let first=(clean.match(/[^.!?]+[.!?]+|[^.!?]+$/)||[clean])[0].trim().replace(/[:;,\-\s]+$/,".");if(!first||first.length<3)first="I found the information.";if(first.length>135){first=first.slice(0,135);const cut=first.lastIndexOf(" ");if(cut>90)first=first.slice(0,cut);first=first.replace(/[,;:\-\s]+$/,".")}if((web||hadLink)&&price&&!first.includes(price))first+=` One price I found is ${price.replace(/\s+/g,"")}.`;if(web||hadLink)first+=" The links and full details are on screen.";return first.replace(/\s+/g," ").trim().slice(0,210)}
function isWebIntent(s){return /\b(search|search for|look up|lookup|find|locate|show me where|online|internet|web|amazon|ebay|walmart|best buy|buy|purchase|order|price|cost|deal|seller|store|where can i get|where can i buy|where do i get|link|website|latest|current|today|news|weather|stock price|score|near me|open now|available|availability)\b/i.test(String(s||""))}
function isDeepIntent(s,personality){if(personality==="expert")return true;return /\b(deep|detailed|in depth|analy[sz]e|analysis|diagnos|troubleshoot|engineering|technical calculation|calculate|complex|reason carefully|compare thoroughly|research deeply|step by step technical|root cause)\b/i.test(String(s||""))}
function buildSearchQuery(text,scene){const t=String(text||"").trim(),s=String(scene||"").trim();return s?`${t}\nSearch using these visible identifying details: ${s.slice(0,900)}`:t}
async function tavilySearchRaw(key,query){const r=await fetch("https://api.tavily.com/search",{method:"POST",headers:{"Authorization":`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({query,search_depth:"basic",max_results:6,include_answer:false,include_raw_content:false,include_images:false,safe_search:true})});const text=await r.text();if(!r.ok)throw new Error(`Tavily ${r.status}: ${text.slice(0,300)}`);return JSON.parse(text)}
function formatTavilyResults(d){return (d.results||[]).map((x,i)=>`${i+1}. ${x.title||"Result"}\n${x.url||""}\n${String(x.content||"").slice(0,700)}`).join("\n\n")}
function formatTavilyDirect(d,request,hadScene,visionError){const rows=(d.results||[]).slice(0,4);if(!rows.length)return "I couldn't find a useful live result for that search.";let out=`I found live web results for: ${request}\n\n`;rows.forEach((x,i)=>{out+=`${i+1}. ${x.title||"Result"}\n${x.url||""}\n${String(x.content||"").slice(0,300)}\n\n`});if(visionError&&!hadScene)out+="Note: the camera identification step was unavailable, so these results are based on your spoken search terms.";return out.trim()}
function isQuotaError(e){return /(?:4006|10,000 neurons|daily free allocation|used up your daily|allowance reached)/i.test(String(e?.message||e))}
function isFalseVisionRefusal(s){return /(?:can(?:not|'t) (?:visually )?(?:see|observe|view|access)|do not have (?:the )?capability to (?:visually )?(?:see|observe)|text-based inputs only|large language model.*(?:see|visual))/i.test(String(s||""))}
function bytesToBase64(bytes){let out="";const step=0x8000;for(let i=0;i<bytes.length;i+=step)out+=String.fromCharCode(...bytes.subarray(i,i+step));return btoa(out)}
function extract(d){if(typeof d==="string")return d.trim();if(d?.output_text)return String(d.output_text).trim();if(d?.response)return String(d.response).trim();if(d?.result?.response)return String(d.result.response).trim();if(d?.text)return String(d.text).trim();if(d?.choices?.[0]?.message?.content)return String(d.choices[0].message.content).trim();if(Array.isArray(d?.output)){const parts=[];for(const item of d.output){for(const c of item?.content||[]){if(c?.text)parts.push(c.text)}}if(parts.length)return parts.join("\n").trim()}return ""}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}
function j(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:{...headers,"Content-Type":"application/json","Cache-Control":"no-store"}})}