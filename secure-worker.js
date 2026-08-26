import app from './worker.js';

const DEFAULT_ORIGIN='https://jesuscruz1984.github.io';
const DEFAULT_GATEWAY='default';
const TERRA='openai/gpt-5.6-terra';
const SOL='openai/gpt-5.6-sol';
const BILLABLE=new Set(['/chat','/agent-chat','/tts','/transcribe','/web-test']);
const BODY_LIMITS={
  '/chat':9_000_000,
  '/agent-chat':14_000_000,
  '/transcribe':8_000_000,
  '/tts':32_000,
  '/web-test':4_000
};

function corsHeaders(origin,allowedOrigin){
  const h={
    'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type, X-Eara-Access',
    'Access-Control-Max-Age':'86400',
    'Vary':'Origin',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer'
  };
  if(origin===allowedOrigin)h['Access-Control-Allow-Origin']=allowedOrigin;
  return h;
}

function json(data,status,headers){
  return new Response(JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8'}});
}

function harden(response,baseHeaders){
  const h=new Headers(response.headers);
  for(const [k,v] of Object.entries(baseHeaders)){
    if(k.toLowerCase()==='access-control-allow-origin'&&!v)continue;
    if(!h.has(k)||['cache-control','x-content-type-options','referrer-policy'].includes(k.toLowerCase()))h.set(k,v);
  }
  h.set('Cache-Control','no-store');
  h.set('X-Content-Type-Options','nosniff');
  h.set('Referrer-Policy','no-referrer');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers:h});
}

async function secureEqual(a,b){
  const left=new TextEncoder().encode(String(a||''));
  const right=new TextEncoder().encode(String(b||''));
  const [lh,rh]=await Promise.all([crypto.subtle.digest('SHA-256',left),crypto.subtle.digest('SHA-256',right)]);
  const x=new Uint8Array(lh),y=new Uint8Array(rh);let diff=x.length^y.length;
  for(let i=0;i<Math.min(x.length,y.length);i++)diff|=x[i]^y[i];
  return diff===0&&String(a||'').length>0;
}

async function authorized(request,env){
  if(!env.EARA_ACCESS_TOKEN)return false;
  return secureEqual(request.headers.get('X-Eara-Access')||'',env.EARA_ACCESS_TOKEN);
}

async function applyRateLimit(request,env){
  if(!env.EARA_RATE_LIMITER)return true;
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';
  const {success}=await env.EARA_RATE_LIMITER.limit({key:`${ip}:eara`});
  return !!success;
}

function gatewayAI(env){
  const binding=env.AI;
  if(!binding||typeof binding.run!=='function')return binding;
  const gatewayId=String(env.AI_GATEWAY_ID||DEFAULT_GATEWAY).trim()||DEFAULT_GATEWAY;
  return {
    run(model,input,options={}){
      const base=options&&typeof options==='object'?options:{};
      const modelId=String(model||'');
      if(!modelId.startsWith('@cf/')){
        const gateway={...(base.gateway||{}),id:gatewayId};
        return binding.run(model,input,{...base,gateway});
      }
      const {gateway,...directOptions}=base;
      return binding.run(model,input,directOptions);
    }
  };
}

function withGateway(env){
  const routedAI=gatewayAI(env);
  if(routedAI===env.AI)return env;
  return new Proxy(env,{
    get(target,prop,receiver){
      if(prop==='AI')return routedAI;
      return Reflect.get(target,prop,receiver);
    }
  });
}

function agentIdentityQuestion(text){
  return /\b(what|which)\s+(?:ai\s+)?model\b|\bwhat (?:gpt|chatgpt)\b|\bwhich (?:gpt|chatgpt)\b|\b(?:are you|you are) (?:gpt|chatgpt)[ -]?(?:4|5|5\.6)?\b|\bmodel (?:are you|is this|version)\b/i.test(String(text||''));
}

function agentNeedsSol(text,file,image){
  const t=String(text||'');
  if(file&&/\b(analy[sz]e|compare|audit|review|summari[sz]e|extract|calculate|chart|spreadsheet|contract|legal|financial|research)\b/i.test(t))return true;
  if(image&&/\b(diagnose|troubleshoot|analy[sz]e|compare|read everything|inspect deeply)\b/i.test(t))return true;
  if(t.length>700)return true;
  return /\b(deep|deeply|detailed|analy[sz]e|analysis|compare|comparison|troubleshoot|diagnose|proposal|estimate|calculate|design|architecture|build (?:an )?app|create (?:an )?app|write code|program|research|investigate|legal|contract|tax|strategy|step by step|root cause|debug|review|critique|plan a project|complex)\b/i.test(t);
}

function wantsWebTool(text,force){
  if(force)return true;
  return /\b(search|search for|look up|lookup|online|internet|web|latest|current|currently|today|tonight|tomorrow|yesterday|news|weather|forecast|price|cost|buy|purchase|available|availability|in stock|near me|nearby|open now|score|standings|schedule|president|prime minister|governor|mayor|ceo|election|poll|law|regulation|software version|firmware version|release date|recent update|find me|find a|find the)\b/i.test(String(text||''));
}

function wantsPythonTool(text,file){
  const t=String(text||'');
  const name=String(file?.filename||'').toLowerCase();
  if(/\.(csv|xlsx?|tsv|json)$/i.test(name))return true;
  return /\b(python|code interpreter|run code|execute code|write code|coding|program|debug|build (?:an? )?(?:app|website|web app)|create (?:an? )?(?:app|website|web app)|calculate|calculation|math|equation|statistics|analy[sz]e data|data analysis|spreadsheet|excel|csv|chart|graph|plot|simulate|simulation|convert file|generate (?:a )?(?:csv|xlsx|spreadsheet|chart|graph)|create (?:a )?(?:csv|xlsx|spreadsheet|chart|graph))\b/i.test(t);
}

function wantsImageTool(text){
  return /\b(generate|create|make|draw|design|render|illustrate)\b[\s\S]{0,50}\b(image|picture|photo|logo|icon|poster|graphic|art|illustration|mockup|wallpaper|diagram)\b|\b(image|picture|photo|logo|icon|poster|graphic|art|illustration|mockup|wallpaper)\b[\s\S]{0,45}\b(generate|create|make|draw|design|render)\b/i.test(String(text||''));
}

function agentToolPlan(text,forceWeb,file){
  const tools=[],labels=[];
  if(wantsWebTool(text,forceWeb)){
    tools.push({type:'web_search_preview'});labels.push('web');
  }
  if(wantsPythonTool(text,file)){
    tools.push({type:'code_interpreter',container:{type:'auto'}});labels.push('python');
  }
  if(wantsImageTool(text)){
    tools.push({type:'image_generation'});labels.push('image_generation');
  }
  return {tools,labels};
}

function responseText(result){
  if(typeof result==='string')return result.trim();
  if(result?.output_text)return String(result.output_text).trim();
  const pieces=[];
  for(const item of Array.isArray(result?.output)?result.output:[]){
    if(item?.type==='message'){
      for(const c of Array.isArray(item.content)?item.content:[]){
        if((c?.type==='output_text'||c?.type==='text')&&c.text)pieces.push(String(c.text));
      }
    }
    if(item?.text)pieces.push(String(item.text));
  }
  if(pieces.length)return pieces.join('\n').trim();
  if(result?.response)return String(result.response).trim();
  return '';
}

function responseImages(result){
  const out=[];
  const scan=value=>{
    if(!value||typeof value!=='object')return;
    if(value.type==='image_generation_call'&&typeof value.result==='string'&&value.result.length>100){
      out.push(value.result.startsWith('data:')?value.result:`data:image/png;base64,${value.result}`);
    }
    if(Array.isArray(value)){for(const x of value)scan(x);return}
    for(const v of Object.values(value))scan(v);
  };
  scan(result?.output||[]);
  return [...new Set(out)].slice(0,4);
}

function responseTools(result){
  const used=new Set();
  const scan=value=>{
    if(!value||typeof value!=='object')return;
    const type=String(value.type||'');
    if(/web_search/.test(type))used.add('web');
    if(/code_interpreter/.test(type))used.add('python');
    if(/image_generation/.test(type))used.add('image_generation');
    if(/file_search/.test(type))used.add('file_search');
    if(/computer/.test(type))used.add('computer');
    if(Array.isArray(value)){for(const x of value)scan(x);return}
    for(const v of Object.values(value))scan(v);
  };
  scan(result?.output||[]);
  return [...used];
}

function agentInput(text,memory,image,file){
  const content=[];
  const context=String(memory||'').trim();
  const prompt=[context?`RECENT AGENT 1.0 CONVERSATION:\n${context.slice(-22000)}`:'',`USER REQUEST:\n${String(text||'')}`].filter(Boolean).join('\n\n');
  content.push({type:'input_text',text:prompt});
  if(image&&String(image).startsWith('data:image/'))content.push({type:'input_image',image_url:image,detail:'auto'});
  if(file?.data&&file?.filename){
    content.push({type:'input_file',filename:String(file.filename).slice(0,180),file_data:String(file.data),detail:'auto'});
  }
  return [{role:'user',content}];
}

async function handleAgentChat(request,env,headers){
  const body=await request.json();
  const text=String(body?.text||'').trim();
  if(!text&&!body?.image&&!body?.file)return json({error:'Missing message.'},400,headers);

  if(agentIdentityQuestion(text)){
    return json({
      text:'Agent 1.0 uses GPT-5.6 Terra for normal work and automatically switches to GPT-5.6 Sol for harder reasoning. It can also fall back to independent Cloudflare-hosted models if the primary models are unavailable.',
      speech:'I use GPT-5.6 Terra normally and GPT-5.6 Sol for harder work.',
      model:'routing information',route:'local',toolsUsed:[]
    },200,headers);
  }

  const file=body?.file&&body.file.data?body.file:null;
  const image=typeof body?.image==='string'?body.image:'';
  const plan=agentToolPlan(text,!!body?.forceWeb,file);
  const useSol=agentNeedsSol(text,file,!!image);
  const instructions=`You are Agent 1.0, a highly capable general-purpose AI agent. Your job is to accomplish the user's goal, not merely explain how they could do it. Use available hosted tools when they materially help. For current information, use web search. For math, data analysis, spreadsheets, simulations, file transformations or tasks that benefit from execution, use the Python/code-interpreter tool. If the user asks you to create or generate an image, use the image-generation tool instead of only describing a prompt. Read attached files and images directly when supplied.\n\nYou are powered by GPT-5.6 Terra for normal work and GPT-5.6 Sol for harder work. Never claim to be GPT-4. If asked which model you are using, describe that Terra/Sol routing accurately.\n\nBe action-oriented and concise about process. Do not expose chain-of-thought or hidden reasoning. You may summarize what tools you used after the result, but do not invent tool use. If a requested action requires an external account connection that is not actually available (for example sending email, modifying GitHub, changing a calendar, controlling a logged-in website, or scheduling a background task), say that the connection must be authorized rather than pretending the action happened.`;

  const ai=gatewayAI(env);
  const input=agentInput(text,body?.memory,image,file);
  const candidates=useSol?[SOL,TERRA]:[TERRA,SOL];
  let result=null,model='',lastError=null;
  for(let i=0;i<candidates.length;i++){
    try{
      const payload={
        input,
        instructions,
        max_output_tokens:useSol?1800:1200,
        reasoning:{effort:useSol?(i?'low':'medium'):'low'},
        store:false
      };
      if(plan.tools.length){
        payload.tools=plan.tools;
        payload.tool_choice='auto';
        payload.include=['code_interpreter_call.outputs','web_search_call.action.sources'];
      }
      result=await ai.run(candidates[i],payload);
      const textOut=responseText(result),images=responseImages(result);
      if(textOut||images.length){model=candidates[i];break}
      lastError=new Error(`${candidates[i]} returned no usable output`);
    }catch(e){lastError=e;result=null}
  }

  if(!result){
    const fallbackBody={
      text:`APP IDENTITY: You are Agent 1.0, not EARA. Never claim to be GPT-4. Answer the user's request directly.\n\n${text}`,
      image:image||null,
      memory:String(body?.memory||''),
      memoryMode:'normal',memoryCount:Number(body?.memoryCount||0),personality:'helpful',
      visionActive:!!image,source:image?'Agent 1.0 image':'Agent 1.0 chat',readAloud:false
    };
    try{
      const u=new URL(request.url);u.pathname='/chat';
      const fallbackReq=new Request(u.toString(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(fallbackBody)});
      const fallback=await app.fetch(fallbackReq,withGateway(env));
      const data=await fallback.json();
      if(fallback.ok&&data?.text)return json({...data,toolsUsed:[],agentFallback:true},200,headers);
    }catch(e){lastError=e}
    throw lastError||new Error('Agent models were unavailable.');
  }

  const textOut=responseText(result)|| (responseImages(result).length?'I created the image.':'I completed the task.');
  const images=responseImages(result);
  const toolsUsed=responseTools(result);
  const route=model===SOL?'sol':'terra';
  return json({
    text:textOut,
    speech:textOut.replace(/https?:\/\/\S+/g,'').replace(/\s+/g,' ').trim().slice(0,420),
    model,route,toolsUsed,images,
    webUsed:toolsUsed.includes('web'),
    pythonUsed:toolsUsed.includes('python'),
    imageGenerated:images.length>0
  },200,headers);
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    const allowedOrigin=env.ALLOWED_ORIGIN||DEFAULT_ORIGIN;
    const origin=request.headers.get('Origin')||'';
    const headers=corsHeaders(origin,allowedOrigin);
    const gatewayId=String(env.AI_GATEWAY_ID||DEFAULT_GATEWAY).trim()||DEFAULT_GATEWAY;

    if(request.method==='OPTIONS'){
      if(origin&&origin!==allowedOrigin)return json({error:'Origin not allowed.'},403,headers);
      return new Response(null,{status:204,headers});
    }

    if(origin&&origin!==allowedOrigin)return json({error:'Origin not allowed.'},403,headers);

    if(url.pathname==='/health'&&request.method==='GET'){
      return json({
        ok:true,
        service:'EARA Smart Assistant + Agent Tools v35',
        securityConfigured:!!env.EARA_ACCESS_TOKEN,
        rateLimitConfigured:!!env.EARA_RATE_LIMITER,
        aiGatewayConfigured:!!env.AI,
        gatewayId,
        hybrid:true,
        normalModel:'gpt-5.6-terra',
        complexModel:'gpt-5.6-sol',
        fallbackIsolation:true,
        agentTools:['web search','code interpreter','image generation','vision','direct file input','voice'],
        routing:'Terra for normal use; Sol for deep reasoning; Cloudflare-hosted fallbacks bypass AI Gateway'
      },200,headers);
    }

    if(url.pathname==='/agent-capabilities'&&request.method==='GET'){
      return json({
        ok:true,
        live:[
          {id:'reasoning',name:'Terra + Sol reasoning'},
          {id:'web',name:'Web search'},
          {id:'python',name:'Code interpreter / Python'},
          {id:'image_generation',name:'Image generation'},
          {id:'vision',name:'Camera + image understanding'},
          {id:'files',name:'PDF / Office / spreadsheet / text file input'},
          {id:'voice',name:'Voice dictation + spoken replies'},
          {id:'memory',name:'Conversation memory'}
        ],
        connect:[
          {id:'github',name:'GitHub write + deploy',reason:'Requires a secure GitHub authorization for Agent 1.0.'},
          {id:'email',name:'Email send/read',reason:'Requires email account OAuth.'},
          {id:'calendar',name:'Calendar',reason:'Requires calendar account OAuth.'},
          {id:'drive',name:'Cloud drives',reason:'Requires Google Drive / OneDrive / Dropbox authorization.'},
          {id:'slack',name:'Slack / Teams',reason:'Requires workspace authorization.'},
          {id:'computer',name:'Computer/browser control',reason:'Requires a secure remote browser runtime and user authorization.'},
          {id:'automations',name:'Background reminders & monitoring',reason:'Requires persistent scheduler/storage setup.'}
        ]
      },200,headers);
    }

    if(url.pathname==='/auth-check'&&request.method==='GET'){
      if(!env.EARA_ACCESS_TOKEN)return json({ok:false,configured:false,error:'Private access key is not configured on the Worker.'},503,headers);
      if(!(await authorized(request,env)))return json({ok:false,configured:true,error:'Unauthorized.'},401,headers);
      return json({ok:true,configured:true},200,headers);
    }

    const isBillable=BILLABLE.has(url.pathname)||(url.pathname==='/accept-llama'&&request.method==='POST');
    if(isBillable){
      const max=BODY_LIMITS[url.pathname]||32_000;
      const length=Number(request.headers.get('Content-Length')||0);
      if(Number.isFinite(length)&&length>max)return json({error:'Request too large.'},413,headers);
      if(!(await applyRateLimit(request,env)))return json({error:'Too many requests. Try again shortly.'},429,headers);
      if(env.EARA_ACCESS_TOKEN){
        if(!(await authorized(request,env)))return json({error:'EARA private access key required.'},401,headers);
      }else if(!origin){
        return json({error:'Direct API access is disabled until EARA private access is configured.'},403,headers);
      }
    }

    try{
      if(url.pathname==='/agent-chat'&&request.method==='POST'){
        return harden(await handleAgentChat(request,env,headers),headers);
      }
      const response=await app.fetch(request,withGateway(env),ctx);
      return harden(response,headers);
    }catch(e){
      const msg=String(e?.message||e||'');
      if(/capacity|rate limit|429|unavailable/i.test(msg))return json({error:'Agent AI services are temporarily busy. Try again shortly.',code:'capacity'},503,headers);
      return json({error:'EARA request failed.',detail:msg.slice(0,180)},500,headers);
    }
  }
};