export default {
  async fetch(request, env) {
    const allowedOrigin=env.ALLOWED_ORIGIN||'https://jesuscruz1984.github.io';
    const origin=request.headers.get('Origin')||'';
    const cors={
      'Access-Control-Allow-Origin':origin===allowedOrigin?origin:allowedOrigin,
      'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers':'Content-Type',
      'Vary':'Origin'
    };
    if(request.method==='OPTIONS')return new Response(null,{headers:cors});
    const url=new URL(request.url);
    if(!env.AI)return j({error:'Cloudflare Workers AI binding is not configured.'},500,cors);

    try{
      if(url.pathname==='/health')return j({
        ok:true,
        service:'EARA smart-memory document backend v23',
        reasoningPrimary:'@cf/openai/gpt-oss-120b',
        reasoningFast:'@cf/google/gemma-4-26b-a4b-it',
        visionPrimary:'@cf/google/gemma-4-26b-a4b-it',
        visionFallback:'@cf/meta/llama-3.2-11b-vision-instruct',
        tts:'@cf/deepgram/aura-1',
        webPrimary:'Tavily direct results',
        memory:'deep local-note retrieval',
        document:'multi-page read-before-summary sessions',
        tavilyConfigured:!!env.TAVILY_API_KEY
      },200,cors);

      if(url.pathname==='/web-test'&&request.method==='GET'){
        if(!env.TAVILY_API_KEY)return j({ok:false,error:'TAVILY_API_KEY is not configured.'},503,cors);
        try{const data=await tavilySearchRaw(env.TAVILY_API_KEY,'OpenAI official website');return j({ok:true,provider:'Tavily',results:(data.results||[]).slice(0,2).map(x=>({title:x.title,url:x.url})),usage:data.usage||null},200,cors)}
        catch(e){return j({ok:false,provider:'Tavily',error:String(e?.message||e)},502,cors)}
      }

      if(url.pathname==='/accept-llama'&&request.method==='GET')return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>EARA Vision Setup</title><style>body{font-family:-apple-system,sans-serif;background:#07111d;color:#fff;padding:28px;max-width:700px;margin:auto}button{width:100%;font-size:20px;font-weight:700;padding:18px;border:0;border-radius:14px;background:#43d2a0;color:#06130e}</style><h1>EARA Vision Setup</h1><form method="post" action="/accept-llama"><button type="submit">I Agree — Enable EARA Vision</button></form>`,{headers:{'Content-Type':'text/html; charset=utf-8'}});
      if(url.pathname==='/accept-llama'&&request.method==='POST'){const result=await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct',{prompt:'agree'});return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,sans-serif;background:#07111d;color:#fff;padding:32px;text-align:center}a{color:#57b8ff}</style><h1>✅ EARA Vision Enabled</h1><a href="https://jesuscruz1984.github.io/">Open EARA</a><pre>${escapeHtml(JSON.stringify(result))}</pre>`,{headers:{'Content-Type':'text/html; charset=utf-8'}})}

      if(url.pathname==='/transcribe'&&request.method==='POST'){
        const incoming=await request.formData(),audio=incoming.get('audio');if(!audio)return j({error:'Missing audio'},400,cors);
        const bytes=[...new Uint8Array(await audio.arrayBuffer())],result=await env.AI.run('@cf/openai/whisper-large-v3-turbo',{audio:bytes});
        return j({text:String(result?.text||result?.result?.text||'').trim()},200,cors);
      }

      if(url.pathname==='/tts'&&request.method==='POST'){
        const {text,speaker}=await request.json();if(!text)return j({error:'Missing text'},400,cors);
        const spoken=makeSpeech(text);if(!spoken)return j({error:'Nothing to speak'},400,cors);
        const allowed=new Set(['angus','asteria','arcas','orion','orpheus','athena','luna','zeus','perseus','helios','hera','stella']);
        const voice=allowed.has(String(speaker||'').toLowerCase())?String(speaker).toLowerCase():'asteria';
        try{
          const raw=await env.AI.run('@cf/deepgram/aura-1',{text:spoken.slice(0,320),speaker:voice,encoding:'mp3'},{returnRawResponse:true});
          const wantsRaw=url.searchParams.get('raw')==='1';
          if(wantsRaw){
            if(raw instanceof Response){const type=raw.headers.get('Content-Type')||'audio/mpeg';return new Response(raw.body||await raw.arrayBuffer(),{status:200,headers:{...cors,'Content-Type':type,'Cache-Control':'no-store','X-Eara-Voice':voice}})}
            let bytes=null;if(raw instanceof ArrayBuffer)bytes=new Uint8Array(raw);else if(ArrayBuffer.isView(raw))bytes=new Uint8Array(raw.buffer,raw.byteOffset,raw.byteLength);else if(raw?.audio&&typeof raw.audio==='string')bytes=base64ToBytes(raw.audio);
            if(bytes)return new Response(bytes,{status:200,headers:{...cors,'Content-Type':'audio/mpeg','Cache-Control':'no-store','X-Eara-Voice':voice}});
          }
          let audio;if(raw instanceof Response)audio=await raw.arrayBuffer();else if(raw instanceof ArrayBuffer)audio=raw;else if(ArrayBuffer.isView(raw))audio=raw.buffer;else if(raw?.audio&&typeof raw.audio==='string')return j({audio:raw.audio,mime:'audio/mpeg',speaker:voice,spoken},200,cors);
          if(!audio)return j({error:'Aura returned no playable audio.'},500,cors);
          return j({audio:bytesToBase64(new Uint8Array(audio)),mime:'audio/mpeg',speaker:voice,spoken},200,cors);
        }catch(e){const status=isCapacityError(e)?503:500;return j({error:isCapacityError(e)?'Premium voice capacity is temporarily busy.':String(e?.message||e),code:isCapacityError(e)?'capacity':'tts'},status,cors)}
      }

      if(url.pathname==='/chat'&&request.method==='POST'){
        const body=await request.json();
        const {text,image,memory,personality,source,memoryMode,memoryCount,documentMode,documentHistory,documentComplete,documentPageCount}=body;
        if(!text)return j({error:'Missing text'},400,cors);
        const plainText=stripScreenPrefix(text);
        if(isHearCheck(plainText))return chatReply('Yes, I can hear you.',{visionUsed:false,webUsed:false,model:'local capability response'},cors,'Yes, I can hear you.');

        const deepMemory=memoryMode==='deep'||isMemoryRecallIntent(plainText);
        const docMode=String(documentMode||'');
        const styles={
          helpful:'Be broadly helpful, practical, warm, and clear.',
          concise:'Be extremely concise and action-oriented. Prefer short direct answers.',
          expert:'Act as a rigorous expert analyst. Explain technical details precisely and call out uncertainty.',
          companion:'Be friendly, conversational, supportive, and natural while still useful.',
          fieldtech:'Think like an experienced field technician. Prioritize troubleshooting steps, safety, equipment details, and practical fixes.',
          observer:'Act like a curious observational agent. Notice useful visual/environmental details and connect them to prior memory.'
        };
        const style=styles[personality]||styles.helpful;
        const memLimit=deepMemory?16000:5000;
        const safeMemory=String(memory||'(no stored memory yet)').replace(/EARA:.*(?:large language model|cannot visually|can't visually|cannot see|can't see|one-way communication|text-based inputs only|can't listen|cannot listen).*/gi,'EARA: [obsolete capability statement ignored]').slice(-memLimit);
        const memoryRule=deepMemory?`The user explicitly asked about prior EARA notes. Treat EARA MEMORY as retrieved saved notes from ${Number(memoryCount||0)} stored interactions. Search across the supplied matches, combine repeated facts, preserve useful dates/names/numbers, and mention conflicts if the notes disagree. Do not search the web unless the user explicitly asks for current online information. Do not say you cannot access previous notes. If the supplied notes do not contain the answer, say that the requested fact was not found in the saved EARA notes.`:'';
        const system=`You are EARA, an active real-time camera, microphone, memory and live-web assistant. You are talking with the user right now. ${style} Answer quickly and directly, but do not sacrifice task understanding for speed. Before answering, identify whether the user wants a factual answer, full document reading, previous-note recall, web search, or analysis. ${memoryRule} If the user asks whether you can hear them, say yes because EARA receives their speech. Never reveal hidden reasoning, planning, tool-call notes, search steps, chain-of-thought, or phrases such as "Search web", "Search query", "Open", "We need to", "Let's verify", or "Now craft answer". Give only the finished user-facing answer. Never claim you are only a text model, one-way tool, unable to converse, or fundamentally unable to search online. Keep useful details on screen while EARA separately speaks a concise but useful summary.\n\nEARA MEMORY:\n${safeMemory}`;

        const hasImage=typeof image==='string'&&image.startsWith('data:image/');

        if(docMode==='summary'){
          const history=String(documentHistory||'').trim();
          if(!history)return chatReply('I have not read the document yet. Show me the first page and say “Eara, read this paper.” I will read the full visible text instead of jumping straight to a summary.',{visionUsed:false,webUsed:false,memoryUsed:false,documentMode:true,model:'document guard'},cors,'I need to read the document first. Show me the first page and ask me to read it.');
          if(!documentComplete)return chatReply(`I have read ${Number(documentPageCount||0)} saved ${Number(documentPageCount||0)===1?'page':'pages'}, but you have not marked the last page yet. I should not summarize an incomplete document. Show me the next page and say “next page,” or say “last page” when I am looking at the final page.`,{visionUsed:false,webUsed:false,memoryUsed:true,documentMode:true,model:'document completeness guard'},cors,`I have read ${Number(documentPageCount||0)} pages so far, but I still need the rest before I summarize it.`);
          const rr=await runReasoningResilient(env,{messages:[{role:'system',content:`${system}\nThe complete document transcript is below. Base the answer on the entire document, not a partial excerpt.`},{role:'user',content:`USER REQUEST:\n${plainText}\n\nCOMPLETE DOCUMENT TRANSCRIPT:\n${history.slice(-30000)}`}],max_tokens:650,temperature:0.25});
          const answer=cleanModelText(extract(rr.result));
          return chatReply(answer||'I could not summarize the completed document.',{visionUsed:false,webUsed:false,memoryUsed:true,documentMode:true,model:rr.model},cors);
        }

        if(['start','start-last','continue','last'].includes(docMode)){
          if(!hasImage)return chatReply('I need the camera view of the page to read it. Enable the camera, hold the page flat and steady, and ask me again.',{visionUsed:false,webUsed:false,documentMode:true,model:'document camera required'},cors,'I need the camera on the page so I can read it.');
          const vr=await runVisionResilient(env,image,plainText,source==='screen',true);
          const transcript=String(vr.text||'').trim();
          if(!transcript)return chatReply('I could not read enough text from this frame. Move closer, keep the whole page in focus, and try again.',{visionUsed:true,webUsed:false,documentMode:true,model:vr.model},cors,'I could not read the page clearly enough. Move closer and hold it steady.');
          const isLast=docMode==='last'||docMode==='start-last';
          const pageNum=Number(documentPageCount||0)+1;
          const footer=isLast?'I have marked this as the last page. I can now summarize or answer questions using the complete saved document.':'If there is more, show me the next page and say “next page.” I will keep reading page by page and will not summarize the document until you identify the last page.';
          const answer=`Page ${pageNum} — full visible transcription:\n\n${transcript}\n\n${footer}`;
          const speech=isLast?`I read page ${pageNum} and marked it as the last page. The full transcription is in the text notes. I can now summarize or answer questions using the complete document.`:`I read all legible text on page ${pageNum} and saved the full transcription in the text notes. If there is another page, show it to me and say next page.`;
          return j({text:answer,speech,documentText:transcript,documentPage:pageNum,documentComplete:isLast,visionUsed:true,webUsed:false,memoryUsed:false,documentMode:true,model:vr.model},200,cors);
        }

        let scene='',visionModel='';
        if(hasImage){const vr=await runVisionResilient(env,image,plainText,source==='screen',false);scene=cleanModelText(vr.text);visionModel=vr.model}
        const wantsWeb=!deepMemory&&isWebIntent(plainText);
        if(scene&&isSimpleVisualQuestion(plainText)&&!wantsWeb)return chatReply(scene,{visionUsed:true,webUsed:false,memoryUsed:false,model:visionModel},cors);

        if(wantsWeb){
          if(env.TAVILY_API_KEY){
            try{
              if(!scene&&isVisualFollowupSearch(plainText)&&hasImage)return chatReply("I can see the camera, but I couldn't identify the item clearly enough to search it. Hold the label or title steady and ask me to find it again.",{visionUsed:false,webUsed:false,memoryUsed:false,model:'vision unavailable'},cors,"I couldn't identify the item clearly enough. Hold it steady and try again.");
              const query=buildSearchQuery(plainText,scene,safeMemory),data=await tavilySearchRaw(env.TAVILY_API_KEY,query),answer=formatTavilyAnswer(data,scene);
              if(answer)return chatReply(answer,{visionUsed:!!scene,webUsed:true,memoryUsed:false,webProvider:'Tavily',model:`Tavily direct${visionModel?' + '+visionModel:''}`},cors,makeWebSpeech(data,scene));
            }catch(_){}
          }
          try{
            const searchPrompt=`${system}\n\n${scene?`CURRENT ${source==='screen'?'SCREEN':'CAMERA'} OBSERVATION:\n${scene}\n\n`:''}USER REQUEST:\n${plainText}\n\nGive only the final user-facing answer with direct URLs. Do not show planning or search steps.`;
            const web=await env.AI.run('openai/gpt-5.5',{input:searchPrompt,max_output_tokens:360,tools:[{type:'web_search_preview'}],reasoning:{effort:'low'}},{gateway:{id:env.AI_GATEWAY_ID||'default'}});
            const webAnswer=cleanModelText(extract(web));if(webAnswer)return chatReply(webAnswer,{visionUsed:!!scene,webUsed:true,memoryUsed:false,webProvider:'Cloudflare AI Gateway',model:'openai/gpt-5.5'},cors);
          }catch(_){}
          return chatReply('Live search failed on this request. Try the search again in a moment.',{visionUsed:!!scene,webUsed:false,memoryUsed:false,model:'web fallback'},cors,'The live search failed. Try again in a moment.');
        }

        const userContext=`${scene?`CURRENT ${source==='screen'?'SHARED SCREEN':'LIVE CAMERA'} OBSERVATION:\n${scene}\n\n`:''}USER:\n${plainText}`;
        const messages=[{role:'system',content:system+(scene?'\nA current visual observation is included. Treat it as what EARA sees now.':'')},{role:'user',content:userContext}];
        const fast=!deepMemory&&isFastPrompt(plainText,personality,!!scene);
        const rr=fast?await runFastReasoning(env,messages):await runReasoningResilient(env,{messages,max_tokens:deepMemory?560:360,temperature:deepMemory?0.25:0.35});
        let answer=cleanModelText(extract(rr.result));if(scene&&isFalseVisionRefusal(answer))answer=scene||'I received the live camera frame, but the visual description failed on this request.';
        return chatReply(answer||"I couldn't generate a response.",{visionUsed:!!scene,webUsed:false,memoryUsed:deepMemory,model:rr.model},cors);
      }

      return j({ok:true,service:'EARA smart-memory document backend v23',reasoning:'Fast Gemma routing + GPT-OSS 120B complex reasoning',vision:'Gemma 4 with Llama fallback',voice:'Deepgram Aura raw audio with quick iPhone fallback',web:'Tavily direct',memory:'deep note retrieval',document:'multi-page read-before-summary'},200,cors);
    }catch(e){if(isCapacityError(e))return j({error:'AI capacity is temporarily busy. EARA will retry/fallback automatically on the next request.',code:'capacity'},503,cors);return j({error:String(e?.message||e),code:'server'},500,cors)}
  }
};

async function runVisionResilient(env,image,userText,isScreen,documentRead=false){
  const kind=isScreen?'shared screen':'live camera frame';
  const visionPrompt=documentRead
    ?`Read this ${kind} as a document-reading task. Transcribe EVERY legible word visible in the frame in natural reading order. Do not summarize, paraphrase, interpret, omit repeated text, or jump to conclusions. Preserve headings, names, dates, amounts, model numbers, addresses, checkbox labels and important punctuation when readable. Mark unreadable pieces as [unclear]. If part of the page is cut off, only transcribe what is actually visible; do not invent missing text. Output only the transcription, with line breaks where useful.`
    :`Inspect this ${kind}. Return only a concise factual identification of the important visible item, text, brand, title, model number, color, warning, or details useful for the user's request. No reasoning or AI limitations.`;
  const gemmaTokens=documentRead?1100:180,llamaTokens=documentRead?950:180;
  try{
    const result=await env.AI.run('@cf/google/gemma-4-26b-a4b-it',{messages:[{role:'system',content:visionPrompt},{role:'user',content:[{type:'text',text:`User request: ${userText}`},{type:'image_url',image_url:{url:image}}]}],max_completion_tokens:gemmaTokens,temperature:documentRead?0:0.1});
    const text=extract(result);if(text)return {text,model:'@cf/google/gemma-4-26b-a4b-it'};
  }catch(_){}
  try{
    const result=await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct',{messages:[{role:'system',content:visionPrompt},{role:'user',content:`User request: ${userText}`}],image,max_tokens:llamaTokens,temperature:documentRead?0:0.1});
    return {text:extract(result),model:'@cf/meta/llama-3.2-11b-vision-instruct'};
  }catch(e){if(isCapacityError(e)){await sleep(180);const result=await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct',{messages:[{role:'system',content:visionPrompt},{role:'user',content:`User request: ${userText}`}],image,max_tokens:documentRead?850:160,temperature:documentRead?0:0.1});return {text:extract(result),model:'@cf/meta/llama-3.2-11b-vision-instruct retry'}}throw e}
}

async function runFastReasoning(env,messages){try{const result=await env.AI.run('@cf/google/gemma-4-26b-a4b-it',{messages,max_completion_tokens:300,temperature:0.35});return {result,model:'@cf/google/gemma-4-26b-a4b-it fast'}}catch(e){if(!isCapacityError(e))throw e;return runReasoningResilient(env,{messages,max_tokens:320,temperature:0.35})}}
async function runReasoningResilient(env,payload){try{const result=await env.AI.run('@cf/openai/gpt-oss-120b',payload);return {result,model:'@cf/openai/gpt-oss-120b'}}catch(e){if(!isCapacityError(e))throw e}await sleep(160);try{const result=await env.AI.run('@cf/openai/gpt-oss-120b',payload);return {result,model:'@cf/openai/gpt-oss-120b retry'}}catch(e){if(!isCapacityError(e))throw e}const result=await env.AI.run('@cf/google/gemma-4-26b-a4b-it',{messages:payload.messages,max_completion_tokens:Math.min(Number(payload.max_tokens||360),700),temperature:payload.temperature??0.35});return {result,model:'@cf/google/gemma-4-26b-a4b-it capacity fallback'}}

function isMemoryRecallIntent(s){return /\b(previous|earlier|past|old|before|last time|our notes|my notes|saved notes|previous notes|memory|memories|history|we discussed|we talked|what did we|what have we|go through (?:our )?notes|look through (?:our )?notes|search (?:our )?notes|from (?:our )?notes|saved interactions|recall|remember when)\b/i.test(String(s||''))}
function isFastPrompt(text,personality,hasScene){const t=String(text||'').trim();if(personality==='expert'||personality==='fieldtech')return false;if(t.length>180)return false;if(/\b(analy[sz]e|deep|detailed|compare|comparison|troubleshoot|diagnose|proposal|estimate|calculate|design|architecture|code|program|research|investigate|legal|contract|tax|strategy|step by step|explain why|previous|notes|memory|document|paper|letter|form|read)\b/i.test(t))return false;if(hasScene&&/\b(explain|why|how|repair|fix|troubleshoot)\b/i.test(t))return false;return true}
function isSimpleVisualQuestion(s){return /^(?:what(?:'s| is) (?:this|that|it)|what am i (?:holding|looking at)|identify (?:this|that|it)|what does (?:this|that) say|can you see (?:this|that|it))\??$/i.test(String(s||'').trim())}
function chatReply(text,meta,cors,speechOverride=''){const full=String(text||'').trim();return j({text:full,speech:speechOverride||makeSpeech(full,!!meta?.webUsed),...meta},200,cors)}
function formatTavilyAnswer(data,scene){const rows=(data?.results||[]).filter(x=>x?.url).slice(0,5);if(!rows.length)return '';const identified=conciseIdentity(scene);let out=identified?`I found matches for ${identified}.\n\n`:'I found these live matches online:\n\n';rows.forEach((x,i)=>{const title=cleanLine(x.title||`Result ${i+1}`),snippet=cleanLine(x.content||''),price=findPrice(`${title} ${snippet}`);out+=`${i+1}. ${title}`;if(price)out+=`\nPrice shown: ${price}`;if(snippet)out+=`\n${snippet.slice(0,180)}`;out+=`\n${x.url}\n\n`});out+='Tap any blue link above to open it.';return out.trim()}
function makeWebSpeech(data,scene){const rows=(data?.results||[]).filter(x=>x?.url).slice(0,5);if(!rows.length)return 'I found matching results online. I put the direct links in the text notes on screen.';const count=rows.length,sites=[];for(const row of rows){const label=siteLabel(row.url);if(label&&!sites.includes(label))sites.push(label)}const item=scene?' for that item':'';if(sites.length===1)return `I found ${count} matching ${sites[0]} ${count===1?'link':'links'}${item}. I put the prices and direct links in the text notes on screen.`;if(sites.length>1){const shown=sites.slice(0,3),names=shown.length===2?`${shown[0]} and ${shown[1]}`:`${shown.slice(0,-1).join(', ')}, and ${shown[shown.length-1]}`;return `I found ${count} matching links${item}, including results from ${names}. I put the prices and direct links in the text notes on screen.`}return `I found ${count} matching ${count===1?'link':'links'}${item}. I put the prices and direct links in the text notes on screen.`}
function siteLabel(u){try{const h=new URL(u).hostname.toLowerCase().replace(/^www\./,'');if(h.includes('amazon.'))return 'Amazon';if(h.includes('walmart.'))return 'Walmart';if(h.includes('ebay.'))return 'eBay';if(h.includes('bestbuy.'))return 'Best Buy';if(h.includes('target.'))return 'Target';if(h.includes('homedepot.'))return 'Home Depot';if(h.includes('lowes.'))return "Lowe's";if(h.includes('youtube.'))return 'YouTube';const base=h.split('.');return base.length>1?base[base.length-2].replace(/(^|[-_])([a-z])/g,(_,a,b)=>(a?' ':'')+b.toUpperCase()):h}catch(_){return ''}}
function conciseIdentity(scene){let s=cleanLine(scene||'');if(!s)return '';s=s.replace(/^(?:the image shows|i see|visible(?: item)?(?: is|:)?|this appears to be)\s*/i,'').trim();if(s.length>100)s=s.slice(0,100).replace(/\s+\S*$/,'');return s}
function cleanLine(s){return String(s||'').replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim()}
function findPrice(s){const m=String(s||'').match(/(?:US\$|\$)\s?\d{1,5}(?:,\d{3})*(?:\.\d{2})?/i);return m?m[0].replace(/\s+/g,''):''}
function cleanModelText(input){let s=String(input||'').trim();if(!s)return '';const bad=/^(?:search web|search query|search result|search|open|provide link|we need to|let'?s (?:search|open|verify|produce)|now craft answer|now produce|spoken summary|on-screen details)\b/i;const lines=s.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);s=lines.filter(x=>!bad.test(x)).join('\n').trim();return s.replace(/^\*\*Spoken Summary:\*\*\s*/i,'').trim()}
function makeSpeech(input,web=false){const raw=cleanModelText(String(input||'').trim());if(!raw)return '';const hadLink=/(?:https?:\/\/|www\.)/i.test(raw),price=findPrice(raw);let clean=raw.replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)]+\)/gi,'$1').replace(/(?:https?:\/\/|www\.)\S+/gi,'').replace(/[\*_`#>|]+/g,' ').replace(/^\s*\d+[.)]\s*/gm,'').replace(/^\s*[-•]\s*/gm,'').replace(/\s+/g,' ').trim();const sentences=clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[clean];let speech=sentences.slice(0,2).join(' ').trim();if(!speech||speech.length<3)speech='I found the information.';if(speech.length>275){speech=speech.slice(0,275);const cut=speech.lastIndexOf(' ');if(cut>215)speech=speech.slice(0,cut);speech=speech.replace(/[,;:\-\s]+$/,'.')}if((web||hadLink)&&price&&!speech.includes(price))speech+=` One price I found is ${price}.`;if((web||hadLink)&&!/\b(?:link|links|text notes|on screen|screen)\b/i.test(speech))speech+=' The links are in the text notes on screen.';return speech.replace(/\s+/g,' ').trim().slice(0,315)}
function isHearCheck(s){return /^(?:(?:eara|era|aira)[, ]*)?(?:can you hear me|do you hear me|are you listening|can you listen to me|you hear me)\??$/i.test(String(s||'').trim())}
function isWebIntent(s){return /\b(search|search for|look up|lookup|find|locate|show me where|online|internet|web|amazon|ebay|walmart|best buy|buy|purchase|order|price|cost|deal|seller|store|where can i get|where can i buy|where do i get|link|website|latest|current|today|news|weather|stock price|score|near me|open now|available|availability|send me the link|give me the link)\b/i.test(String(s||''))}
function isVisualFollowupSearch(s){return /\b(this|that|these|those|what i'?m holding|what am i holding|in my hand|shown|showing|camera|see)\b/i.test(String(s||''))}
function buildSearchQuery(text,scene,memory){const t=String(text||'').trim(),s=String(scene||'').trim();if(s)return `${t}\nExact visible item details: ${s}`;if(/^(?:give|send|show).*(?:link|price)|^(?:find|buy|order) (?:it|that|this)\b/i.test(t)){const m=String(memory||'').split(/\n\n/).slice(-2).join(' ').replace(/\s+/g,' ').slice(-700);if(m)return `${t}\nRecent conversation context: ${m}`}return t}
async function tavilySearchRaw(key,query){const r=await fetch('https://api.tavily.com/search',{method:'POST',headers:{'Authorization':`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({query,search_depth:'basic',max_results:5,include_answer:false,include_raw_content:false,include_images:false})});const text=await r.text();if(!r.ok)throw new Error(`Tavily ${r.status}: ${text.slice(0,300)}`);return JSON.parse(text)}
function stripScreenPrefix(s){return String(s||'').replace(/^SCREEN SHARE ACTIVE\.[\s\S]*?request:\s*/i,'').trim()}
function isCapacityError(e){return /(?:3040|capacity temporarily exceeded|out of capacity|capacity is temporarily|temporarily exceeded|AI capacity)/i.test(String(e?.message||e))}
function isFalseVisionRefusal(s){return /(?:can(?:not|'t) (?:visually )?(?:see|observe|view|access)|do not have (?:the )?capability to (?:visually )?(?:see|observe)|text-based inputs only|large language model.*(?:see|visual))/i.test(String(s||''))}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
function bytesToBase64(bytes){let out='';const step=0x8000;for(let i=0;i<bytes.length;i+=step)out+=String.fromCharCode(...bytes.subarray(i,i+step));return btoa(out)}
function base64ToBytes(s){const bin=atob(String(s||'')),out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out}
function extract(d){if(typeof d==='string')return d.trim();if(d?.output_text)return String(d.output_text).trim();if(d?.response)return String(d.response).trim();if(d?.result?.response)return String(d.result.response).trim();if(d?.text)return String(d.text).trim();if(d?.choices?.[0]?.message?.content){const c=d.choices[0].message.content;if(typeof c==='string')return c.trim();if(Array.isArray(c))return c.map(x=>x?.text||'').filter(Boolean).join('\n').trim()}if(Array.isArray(d?.output)){const parts=[];for(const item of d.output)for(const c of item?.content||[])if(c?.text)parts.push(c.text);if(parts.length)return parts.join('\n').trim()}return ''}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function j(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json','Cache-Control':'no-store'}})}
