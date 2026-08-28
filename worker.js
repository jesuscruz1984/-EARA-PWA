const TERRA='openai/gpt-5.6-terra';
const SOL='openai/gpt-5.6-sol';
const OSS='@cf/openai/gpt-oss-120b';
const GEMMA='@cf/google/gemma-4-26b-a4b-it';
const LLAMA_VISION='@cf/meta/llama-3.2-11b-vision-instruct';

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
    if(!env.AI)return j({error:'Cloudflare AI binding is not configured.'},500,cors);

    try{
      if(url.pathname==='/health')return j({
        ok:true,
        service:'EARA smart assistant backend v43',
        defaultModel:TERRA,
        deepModel:SOL,
        fallbackModel:OSS,
        vision:'GPT-5.6 Terra/Sol image input with legacy fallback',
        voice:'Deepgram Aura',
        transcription:'Whisper Large v3 Turbo',
        web:'Tavily + GPT-5.6 synthesis; OpenAI web-search fallback',
        memory:'local conversation context + deep recall',
        liveVision:'current-frame visual follow-ups',
        tavilyConfigured:!!env.TAVILY_API_KEY
      },200,cors);

      if(url.pathname==='/web-test'&&request.method==='GET'){
        if(!env.TAVILY_API_KEY)return j({ok:false,error:'TAVILY_API_KEY is not configured.'},503,cors);
        try{
          const data=await tavilySearchRaw(env.TAVILY_API_KEY,'OpenAI official website');
          return j({ok:true,provider:'Tavily',results:(data.results||[]).slice(0,2).map(x=>({title:x.title,url:x.url})),usage:data.usage||null},200,cors);
        }catch(e){return j({ok:false,provider:'Tavily',error:String(e?.message||e)},502,cors)}
      }

      if(url.pathname==='/accept-llama'&&request.method==='GET'){
        return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>EARA Vision</title><style>body{font-family:-apple-system,sans-serif;background:#07111d;color:#fff;padding:28px;max-width:700px;margin:auto}a{color:#57b8ff}</style><h1>EARA Vision</h1><p>EARA now uses GPT-5.6 vision first with an automatic legacy vision fallback.</p><a href="https://jesuscruz1984.github.io/">Open EARA</a>',{headers:{'Content-Type':'text/html; charset=utf-8'}});
      }
      if(url.pathname==='/accept-llama'&&request.method==='POST'){
        try{await env.AI.run(LLAMA_VISION,{prompt:'agree'})}catch(_){}
        return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,sans-serif;background:#07111d;color:#fff;padding:32px;text-align:center}a{color:#57b8ff}</style><h1>✅ EARA Vision Ready</h1><a href="https://jesuscruz1984.github.io/">Open EARA</a>',{headers:{'Content-Type':'text/html; charset=utf-8'}});
      }

      if(url.pathname==='/transcribe'&&request.method==='POST'){
        const incoming=await request.formData(),audio=incoming.get('audio');
        if(!(audio instanceof Blob)||!audio.size)return j({error:'Missing audio'},400,cors);
        if(audio.size>7_500_000)return j({error:'Audio segment is too large'},413,cors);
        const mime=String(audio.type||'audio/webm').split(';')[0]||'audio/webm';
        const buffer=await audio.arrayBuffer();
        const options={
          task:'transcribe',
          language:'en',
          vad_filter:true,
          condition_on_previous_text:false,
          no_speech_threshold:0.65
        };
        let result;
        try{
          // Workers AI's current typed interface accepts an audio stream plus its MIME type.
          const body=new Blob([buffer],{type:mime}).stream();
          result=await env.AI.run('@cf/openai/whisper-large-v3-turbo',{audio:{body,contentType:mime},...options});
        }catch(firstError){
          // Some older Workers AI deployments expect base64 instead of the stream form.
          if(!/audio|schema|type|input|binary|array|required propert/i.test(String(firstError?.message||firstError)))throw firstError;
          result=await env.AI.run('@cf/openai/whisper-large-v3-turbo',{audio:bytesToBase64(new Uint8Array(buffer)),...options});
        }
        return j({text:String(result?.text||result?.result?.text||'').trim()},200,cors);
      }

      if(url.pathname==='/tts'&&request.method==='POST'){
        const {text,speaker}=await request.json();
        if(!text)return j({error:'Missing text'},400,cors);
        const spoken=makeTtsSpeech(text);
        if(!spoken)return j({error:'Nothing to speak'},400,cors);
        const allowed=new Set(['angus','asteria','arcas','orion','orpheus','athena','luna','zeus','perseus','helios','hera','stella']);
        const voice=allowed.has(String(speaker||'').toLowerCase())?String(speaker).toLowerCase():'asteria';
        try{
          const raw=await env.AI.run('@cf/deepgram/aura-1',{text:spoken.slice(0,420),speaker:voice,encoding:'mp3'},{returnRawResponse:true});
          const wantsRaw=url.searchParams.get('raw')==='1';
          if(wantsRaw){
            if(raw instanceof Response){
              const type=raw.headers.get('Content-Type')||'audio/mpeg';
              return new Response(raw.body||await raw.arrayBuffer(),{status:200,headers:{...cors,'Content-Type':type,'Cache-Control':'no-store','X-Eara-Voice':voice}});
            }
            let bytes=null;
            if(raw instanceof ArrayBuffer)bytes=new Uint8Array(raw);
            else if(ArrayBuffer.isView(raw))bytes=new Uint8Array(raw.buffer,raw.byteOffset,raw.byteLength);
            else if(raw?.audio&&typeof raw.audio==='string')bytes=base64ToBytes(raw.audio);
            if(bytes)return new Response(bytes,{status:200,headers:{...cors,'Content-Type':'audio/mpeg','Cache-Control':'no-store','X-Eara-Voice':voice}});
          }
          let audio;
          if(raw instanceof Response)audio=await raw.arrayBuffer();
          else if(raw instanceof ArrayBuffer)audio=raw;
          else if(ArrayBuffer.isView(raw))audio=raw.buffer;
          else if(raw?.audio&&typeof raw.audio==='string')return j({audio:raw.audio,mime:'audio/mpeg',speaker:voice,spoken},200,cors);
          if(!audio)return j({error:'Aura returned no playable audio.'},500,cors);
          return j({audio:bytesToBase64(new Uint8Array(audio)),mime:'audio/mpeg',speaker:voice,spoken},200,cors);
        }catch(e){
          const status=isCapacityError(e)?503:500;
          return j({error:isCapacityError(e)?'Premium voice capacity is temporarily busy.':String(e?.message||e),code:isCapacityError(e)?'capacity':'tts'},status,cors);
        }
      }

      if(url.pathname==='/chat'&&request.method==='POST'){
        return await handleChat(request,env,cors);
      }

      return j({
        ok:true,
        service:'EARA smart assistant backend v43',
        intelligence:'GPT-5.6 Terra everyday + GPT-5.6 Sol deep reasoning',
        vision:'GPT-5.6 live-frame vision',
        web:'automatic current-information search',
        voice:'Deepgram Aura',
        memory:'conversation + deep recall'
      },200,cors);
    }catch(e){
      if(isCapacityError(e)||/All EARA .*models were unavailable/i.test(String(e?.message||e))){
        return j({error:'EARA’s AI services are temporarily busy. Try again; EARA will automatically use its fallback model ladder.',code:'capacity'},503,cors);
      }
      return j({error:String(e?.message||e),code:'server'},500,cors);
    }
  }
};

async function handleChat(request,env,cors){
  const body=await request.json();
  const {
    text,image,memory,personality,source,memoryMode,memoryCount,
    documentMode,documentHistory,documentComplete,documentPageCount,readAloud
  }=body;
  if(!text)return j({error:'Missing text'},400,cors);
  const plainText=stripScreenPrefix(text);
  if(isHearCheck(plainText)){
    return chatReply('Yes, I can hear you.',{visionUsed:false,webUsed:false,memoryUsed:false,model:'local capability response',route:'local'},cors,'Yes, I can hear you.');
  }

  const deepMemory=memoryMode==='deep'||isMemoryRecallIntent(plainText);
  const docMode=String(documentMode||'');
  const hasImage=typeof image==='string'&&image.startsWith('data:image/');
  const safeMemory=cleanMemory(memory,deepMemory);
  const style=personalityStyle(personality);
  const instructions=baseInstructions(style,deepMemory,memoryCount,readAloud);

  if(docMode==='summary'){
    const history=String(documentHistory||'').trim();
    if(!history)return chatReply('I have not read the document yet. Show me the first page and say “Eara, read this paper.”',{visionUsed:false,webUsed:false,memoryUsed:false,documentMode:true,model:'document guard'},cors,'I need to read the document first.');
    if(!documentComplete)return chatReply(`I have read ${Number(documentPageCount||0)} saved ${Number(documentPageCount||0)===1?'page':'pages'}, but I still need the rest. Show me the next page, or say “last page” on the final page.`,{visionUsed:false,webUsed:false,memoryUsed:true,documentMode:true,model:'document completeness guard'},cors,`I have read ${Number(documentPageCount||0)} pages so far, but I still need the rest.`);
    const input=makeInput(
      `${memoryBlock(safeMemory)}\n\nCOMPLETE DOCUMENT TRANSCRIPT:\n${history.slice(-60000)}\n\nUSER REQUEST:\n${plainText}`,
      null
    );
    const rr=await runHybrid(env,{useSol:true,instructions:`${instructions}\nThe complete document transcript is supplied. Use the whole document. Give a clear final answer; do not expose hidden reasoning.`,input,maxOutput:1000,effort:'medium'});
    const answer=cleanModelText(extract(rr.result));
    return chatReply(answer||'I could not summarize the completed document.',{visionUsed:false,webUsed:false,memoryUsed:true,documentMode:true,model:rr.model,route:rr.route},cors);
  }

  if(['start','start-last','continue','last'].includes(docMode)){
    if(!hasImage)return chatReply('I need the camera view of the page to read it. Hold the page flat and steady and ask me again.',{visionUsed:false,webUsed:false,documentMode:true,model:'document camera required'},cors,'I need the camera on the page so I can read it.');
    const docInstructions=`You are EARA reading a document from the ${source==='screen'?'shared screen':'live camera'}. Transcribe EVERY legible word visible in natural reading order. Do not summarize or paraphrase. Preserve headings, names, dates, amounts, model numbers, addresses, checkbox labels, and important punctuation when readable. Mark unreadable text as [unclear]. Do not invent text outside the image. Output only the transcription.`;
    const vr=await runHybrid(env,{useSol:false,instructions:docInstructions,input:makeInput(`Transcribe the visible page.`,image,'original'),maxOutput:1800,effort:'none',vision:true});
    let transcript=cleanModelText(extract(vr.result));
    if(!transcript){
      const legacy=await runLegacyVision(env,image,'Transcribe every legible word on this page.',source==='screen',true);
      transcript=String(legacy.text||'').trim();
    }
    if(!transcript)return chatReply('I could not read enough text from this frame. Move closer, keep the whole page in focus, and try again.',{visionUsed:true,webUsed:false,documentMode:true,model:vr.model},cors,'I could not read the page clearly enough. Move closer and hold it steady.');
    const isLast=docMode==='last'||docMode==='start-last';
    const pageNum=Number(documentPageCount||0)+1;
    const footer=isLast?'I marked this as the last page. I can now summarize or answer questions using the full document.':'If there is more, show the next page and say “next page.”';
    const answer=`Page ${pageNum} — full visible transcription:\n\n${transcript}\n\n${footer}`;
    const speech=isLast?`I read page ${pageNum} and marked it as the last page. The full transcription is on screen. I can now summarize or answer questions about the document.`:`I read page ${pageNum} and saved the full transcription on screen. Show me the next page and say next page.`;
    return j({text:answer,speech,documentText:transcript,documentPage:pageNum,documentComplete:isLast,visionUsed:true,webUsed:false,memoryUsed:false,documentMode:true,model:vr.model,route:vr.route},200,cors);
  }

  const wantsWeb=!deepMemory&&needsCurrentWeb(plainText);
  const useSol=shouldUseSol(plainText,personality,deepMemory,hasImage,wantsWeb);
  let searchData=null,sceneHint='';

  if(wantsWeb&&env.TAVILY_API_KEY){
    try{
      if(hasImage&&isCommerceOrLinkIntent(plainText)){
        const idr=await runHybrid(env,{
          useSol:false,
          instructions:'Identify the main visible product or item precisely enough to search for it online. Return only useful search terms: brand, product name, model number, size/version, and distinctive text. Do not explain.',
          input:makeInput(plainText,image,'auto'),
          maxOutput:180,
          effort:'none',
          vision:true
        });
        sceneHint=cleanLine(extract(idr.result)).slice(0,400);
      }
      searchData=await tavilySearchRaw(env.TAVILY_API_KEY,buildSearchQuery(plainText,sceneHint,safeMemory));
    }catch(_){searchData=null}
  }

  const webContext=searchData?formatSearchContext(searchData):'';
  const liveContext=hasImage?`The user has supplied the CURRENT ${source==='screen'?'shared screen':'live camera'} frame. Treat it as what EARA can see right now.`:'';
  const inputText=[
    liveContext,
    safeMemory?memoryBlock(safeMemory):'',
    webContext?`LIVE WEB RESULTS:\n${webContext}`:'',
    `USER REQUEST:\n${plainText}`
  ].filter(Boolean).join('\n\n');

  let rr;
  if(wantsWeb&&!searchData){
    try{
      rr=await runHybrid(env,{
        useSol,
        instructions:`${instructions}\nCurrent information matters for this request. Use web search when needed. Give only the final answer. If you use web information, be clear about dates and uncertainty.`,
        input:makeInput(inputText,image,'auto'),
        maxOutput:useSol?800:600,
        effort:useSol?'medium':'low',
        tools:[{type:'web_search_preview'}],
        vision:hasImage
      });
    }catch(_){
      rr=await runHybrid(env,{
        useSol,
        instructions,
        input:makeInput(inputText,image,'auto'),
        maxOutput:useSol?700:520,
        effort:useSol?'medium':'low',
        vision:hasImage
      });
    }
  }else{
    rr=await runHybrid(env,{
      useSol,
      instructions:`${instructions}${webContext?'\nUse the supplied live web results as current evidence. Do not invent prices, URLs, dates, or facts not supported by them.':''}`,
      input:makeInput(inputText,image,'auto'),
      maxOutput:useSol?850:560,
      effort:useSol?'medium':'low',
      vision:hasImage
    });
  }

  let answer=cleanModelText(extract(rr.result));
  if(!answer&&hasImage){
    const legacy=await runLegacyVision(env,image,plainText,source==='screen',false);
    answer=cleanModelText(legacy.text);
  }
  if(!answer)answer="I couldn't generate a response.";

  if(searchData){
    const sources=formatSourceLinks(searchData);
    if(sources)answer=`${answer}\n\n${sources}`.trim();
  }

  const speech=makeSpeech(answer,!!searchData||wantsWeb);
  return chatReply(answer,{visionUsed:hasImage,webUsed:!!searchData||wantsWeb,memoryUsed:deepMemory,webProvider:searchData?'Tavily + GPT-5.6':'GPT-5.6 web search',model:rr.model,route:rr.route},cors,speech);
}

function baseInstructions(style,deepMemory,memoryCount,readAloud){
  const memoryRule=deepMemory
    ?`The user is asking about previous EARA notes. Treat the supplied EARA MEMORY as retrieved conversation history from ${Number(memoryCount||0)} saved interactions. Combine matching facts, preserve names/dates/numbers, mention conflicts, and say when the requested fact is not present.`
    :'Use the supplied EARA MEMORY only as conversation context when it helps.';
  return `You are EARA, a highly capable general-purpose personal AI assistant. Work like a simple modern ChatGPT-style assistant: the user can ask about almost any ordinary subject—general knowledge, technology, business, writing, math, travel, products, troubleshooting, planning, explanations, ideas, or everyday life. ${style}
Understand conversational follow-ups naturally. If a live camera or screen frame is supplied, use it as current visual context without making the user restate what they are showing. ${memoryRule}
Answer the user's actual question directly. Do not over-narrate what you are doing. Never expose hidden reasoning, planning, tool-call notes, chain-of-thought, model routing, or search steps. Do not say you are only a text model when a camera frame, microphone transcript, memory, or web results are actually supplied. Keep the on-screen answer useful and reasonably detailed; speech is generated separately and should stay concise. Never read raw URLs aloud.${readAloud?' The user explicitly asked for full read-aloud content, so preserve the requested wording instead of summarizing it.':''}`;
}

function personalityStyle(p){
  const styles={
    helpful:'Be broadly helpful, practical, warm, natural, and clear.',
    concise:'Be fast, concise, and action-oriented while still answering completely.',
    expert:'Be rigorous and technically precise. Explain important assumptions and uncertainty.',
    companion:'Be friendly, conversational, natural, and useful.',
    fieldtech:'Think like an experienced field technician. Prioritize practical troubleshooting, safety, equipment details, and field-ready steps.',
    observer:'Be observant and connect useful visual details to the user’s question and recent context.'
  };
  return styles[p]||styles.helpful;
}

function cleanMemory(memory,deep){
  return String(memory||'')
    .replace(/EARA:.*(?:large language model|cannot visually|can't visually|cannot see|can't see|one-way communication|text-based inputs only|can't listen|cannot listen).*/gi,'EARA: [obsolete capability statement ignored]')
    .slice(-(deep?22000:9000));
}
function memoryBlock(s){return `EARA MEMORY / RECENT CONVERSATION:\n${s}`}

function makeInput(text,image,detail='auto'){
  const content=[{type:'input_text',text:String(text||'')}];
  if(image)content.push({type:'input_image',image_url:image,detail});
  return [{role:'user',content}];
}

async function runHybrid(env,{useSol,instructions,input,maxOutput=600,effort='low',tools=[],vision=false}){
  const first=useSol?SOL:TERRA;
  const second=useSol?TERRA:SOL;
  const candidates=[first,second];
  let lastError=null;
  for(let i=0;i<candidates.length;i++){
    const model=candidates[i];
    try{
      const payload={
        input,
        instructions,
        max_output_tokens:maxOutput,
        reasoning:{effort:i?lowerEffort(effort):effort},
        store:false
      };
      if(tools?.length){payload.tools=tools;payload.tool_choice='auto'}
      const result=await env.AI.run(model,payload);
      if(hasUsableAnswer(result))return {result,model,route:model===SOL?'sol':'terra'};
      lastError=new Error(`${model} returned an empty answer`);
    }catch(e){lastError=e}
  }

  if(vision){
    try{
      const image=findImageInInput(input);
      const text=findTextInInput(input);
      if(image){
        const legacy=await runLegacyVision(env,image,text,false,false);
        if(legacy.text)return {result:{response:legacy.text},model:legacy.model,route:'vision-fallback'};
      }
    }catch(e){lastError=e}
  }

  try{
    const prompt=`${instructions}\n\n${findTextInInput(input)}`.slice(-32000);
    const result=await env.AI.run(OSS,{messages:[{role:'user',content:prompt}],max_tokens:Math.min(maxOutput,1200),temperature:0.3});
    if(hasUsableAnswer(result))return {result,model:OSS,route:'oss-fallback'};
  }catch(e){lastError=e}

  try{
    const prompt=`${instructions}\n\n${findTextInInput(input)}`.slice(-24000);
    const result=await env.AI.run(GEMMA,{messages:[{role:'user',content:prompt}],max_completion_tokens:Math.min(maxOutput,1000),temperature:0.3});
    if(hasUsableAnswer(result))return {result,model:GEMMA,route:'gemma-fallback'};
  }catch(e){lastError=e}

  throw new Error(`All EARA reasoning models were unavailable: ${String(lastError?.message||lastError||'unknown error').slice(0,220)}`);
}

function lowerEffort(e){return e==='max'?'high':e==='xhigh'?'high':e==='high'?'medium':e==='medium'?'low':e==='low'?'none':'none'}

async function runLegacyVision(env,image,userText,isScreen,documentRead=false){
  const kind=isScreen?'shared screen':'live camera frame';
  const prompt=documentRead
    ?`Read this ${kind} as a document. Transcribe every legible word in natural reading order. Do not summarize. Mark unreadable pieces as [unclear].`
    :`Inspect this ${kind} and answer the user's request using what is visible. Be concise and factual. User request: ${userText}`;
  try{
    const result=await env.AI.run(GEMMA,{messages:[{role:'system',content:prompt},{role:'user',content:[{type:'text',text:String(userText||'')},{type:'image_url',image_url:{url:image}}]}],max_completion_tokens:documentRead?1200:420,temperature:0.1});
    const text=extract(result);
    if(text)return {text,model:GEMMA};
  }catch(_){}
  const result=await env.AI.run(LLAMA_VISION,{messages:[{role:'system',content:prompt},{role:'user',content:String(userText||'')}],image,max_tokens:documentRead?1000:420,temperature:0.1});
  return {text:extract(result),model:LLAMA_VISION};
}

function shouldUseSol(text,personality,deepMemory,hasImage,wantsWeb){
  const t=String(text||'').trim();
  if(deepMemory||personality==='expert'||personality==='fieldtech')return true;
  if(t.length>650)return true;
  if(/\b(deep|deeply|detailed|analy[sz]e|analysis|compare|comparison|troubleshoot|diagnose|proposal|estimate|calculate|design|architecture|code|program|research|investigate|legal|contract|tax|strategy|step by step|explain why|reason through|pros and cons|best approach|root cause|debug|review this|critique)\b/i.test(t))return true;
  if(hasImage&&/\b(troubleshoot|diagnose|repair|fix|compare|analy[sz]e|read everything|explain why)\b/i.test(t))return true;
  if(wantsWeb&&/\b(research|compare|best|deep|investigate|analy[sz]e)\b/i.test(t))return true;
  return false;
}

function needsCurrentWeb(s){
  const t=String(s||'');
  return /\b(search|search for|look up|lookup|find online|online|internet|web|amazon|ebay|walmart|best buy|target|home depot|lowe'?s|buy|purchase|order|price|cost|deal|seller|store|where can i get|where can i buy|link|website|latest|current|currently|today|tonight|tomorrow|yesterday|news|weather|forecast|stock price|market price|score|standings|schedule|near me|nearby|open now|available|availability|in stock|president|prime minister|governor|mayor|ceo|election|poll|law|regulation|rule change|software version|firmware version|release date|recent update)\b/i.test(t);
}
function isCommerceOrLinkIntent(s){return /\b(amazon|ebay|walmart|best buy|target|home depot|lowe'?s|buy|purchase|order|price|cost|deal|seller|store|where can i get|where can i buy|link|website|in stock|available)\b/i.test(String(s||''))}
function isMemoryRecallIntent(s){return /\b(previous|earlier|past|old|before|last time|our notes|my notes|saved notes|previous notes|memory|memories|history|we discussed|we talked|what did we|what have we|go through (?:our )?notes|look through (?:our )?notes|search (?:our )?notes|from (?:our )?notes|saved interactions|recall|remember when)\b/i.test(String(s||''))}
function isHearCheck(s){return /^(?:(?:eara|era|aira)[, ]*)?(?:can you hear me|do you hear me|are you listening|can you listen to me|you hear me)\??$/i.test(String(s||'').trim())}

function buildSearchQuery(text,scene,memory){
  const t=String(text||'').trim(),s=String(scene||'').trim();
  if(s)return `${t}\nExact visible item details: ${s}`;
  if(/^(?:give|send|show).*(?:link|price)|^(?:find|buy|order) (?:it|that|this)\b/i.test(t)){
    const m=String(memory||'').split(/\n\n/).slice(-3).join(' ').replace(/\s+/g,' ').slice(-900);
    if(m)return `${t}\nRecent conversation context: ${m}`;
  }
  return t;
}

async function tavilySearchRaw(key,query){
  const r=await fetch('https://api.tavily.com/search',{
    method:'POST',
    headers:{'Authorization':`Bearer ${key}`,'Content-Type':'application/json'},
    body:JSON.stringify({query,search_depth:'basic',max_results:5,include_answer:false,include_raw_content:false,include_images:false})
  });
  const text=await r.text();
  if(!r.ok)throw new Error(`Tavily ${r.status}: ${text.slice(0,300)}`);
  return JSON.parse(text);
}
function formatSearchContext(data){
  return (data?.results||[]).filter(x=>x?.url).slice(0,5).map((x,i)=>[
    `Result ${i+1}: ${cleanLine(x.title||'')}`,
    `URL: ${x.url}`,
    cleanLine(x.content||'').slice(0,700)
  ].filter(Boolean).join('\n')).join('\n\n');
}
function formatSourceLinks(data){
  const rows=(data?.results||[]).filter(x=>x?.url).slice(0,5);
  if(!rows.length)return '';
  return `Sources / links:\n${rows.map((x,i)=>`${i+1}. ${cleanLine(x.title||'Result')}\n${x.url}`).join('\n\n')}`;
}

function findTextInInput(input){
  if(typeof input==='string')return input;
  const parts=[];
  for(const item of Array.isArray(input)?input:[]){
    for(const c of Array.isArray(item?.content)?item.content:[]){
      if(c?.type==='input_text'&&c.text)parts.push(c.text);
    }
  }
  return parts.join('\n');
}
function findImageInInput(input){
  for(const item of Array.isArray(input)?input:[]){
    for(const c of Array.isArray(item?.content)?item.content:[]){
      if(c?.type==='input_image'&&c.image_url)return c.image_url;
    }
  }
  return '';
}

function hasUsableAnswer(result){return cleanModelText(extract(result)).length>1}
function chatReply(text,meta,cors,speechOverride=''){
  const full=String(text||'').trim();
  return j({text:full,speech:speechOverride||makeSpeech(full,!!meta?.webUsed),...meta},200,cors);
}
function cleanModelText(input){
  let s=String(input||'').trim();
  if(!s)return '';
  const bad=/^(?:search web|search query|search result|search|open|provide link|we need to|let'?s (?:search|open|verify|produce)|now craft answer|now produce|spoken summary|on-screen details)\b/i;
  const lines=s.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  s=lines.filter(x=>!bad.test(x)).join('\n').trim();
  return s.replace(/^\*\*Spoken Summary:\*\*\s*/i,'').trim();
}
function cleanLine(s){return String(s||'').replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim()}
function makeTtsSpeech(input){
  return cleanModelText(String(input||'').trim())
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)]+\)/gi,'$1')
    .replace(/(?:https?:\/\/|www\.)\S+/gi,'')
    .replace(/\bSources?\s*\/?\s*links?:[\s\S]*$/i,'')
    .replace(/[\*_`#>|]+/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,700);
}
function makeSpeech(input,web=false){
  const raw=cleanModelText(String(input||'').trim());
  if(!raw)return '';
  const hadLink=/(?:https?:\/\/|www\.)/i.test(raw);
  let clean=raw
    .replace(/\bSources?\s*\/?\s*links?:[\s\S]*$/i,'')
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)]+\)/gi,'$1')
    .replace(/(?:https?:\/\/|www\.)\S+/gi,'')
    .replace(/[\*_`#>|]+/g,' ')
    .replace(/^\s*\d+[.)]\s*/gm,'')
    .replace(/^\s*[-•]\s*/gm,'')
    .replace(/\s+/g,' ')
    .trim();
  const sentences=clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[clean];
  let speech=sentences.slice(0,2).join(' ').trim();
  if(!speech||speech.length<3)speech='I found the information.';
  if(speech.length>320){
    speech=speech.slice(0,320);
    const cut=speech.lastIndexOf(' ');
    if(cut>240)speech=speech.slice(0,cut);
    speech=speech.replace(/[,;:\-\s]+$/,'.');
  }
  if((web||hadLink)&&!/links? (?:are|is)|on screen|text notes/i.test(speech))speech+=' I put the useful links on screen.';
  return speech.replace(/\s+/g,' ').trim().slice(0,380);
}
function stripScreenPrefix(s){return String(s||'').replace(/^SCREEN SHARE ACTIVE\.[\s\S]*?request:\s*/i,'').trim()}
function isCapacityError(e){return /(?:3040|capacity temporarily exceeded|out of capacity|capacity is temporarily|temporarily exceeded|AI capacity|rate limit|429)/i.test(String(e?.message||e))}
function bytesToBase64(bytes){let out='';const step=0x8000;for(let i=0;i<bytes.length;i+=step)out+=String.fromCharCode(...bytes.subarray(i,i+step));return btoa(out)}
function base64ToBytes(s){const bin=atob(String(s||'')),out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out}
function extract(d){
  if(typeof d==='string')return d.trim();
  if(d?.output_text)return String(d.output_text).trim();
  if(d?.response)return String(d.response).trim();
  if(d?.result?.response)return String(d.result.response).trim();
  if(d?.text)return String(d.text).trim();
  if(d?.choices?.[0]?.message?.content){
    const c=d.choices[0].message.content;
    if(typeof c==='string')return c.trim();
    if(Array.isArray(c))return c.map(x=>x?.text||x?.content||'').filter(Boolean).join('\n').trim();
  }
  if(Array.isArray(d?.output)){
    const parts=[];
    for(const item of d.output){
      for(const c of item?.content||[]){
        if(c?.text)parts.push(c.text);
        else if(c?.type==='output_text'&&c?.text)parts.push(c.text);
      }
    }
    if(parts.length)return parts.join('\n').trim();
  }
  return '';
}
function j(data,status=200,headers={}){
  return new Response(JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json','Cache-Control':'no-store'}});
}

