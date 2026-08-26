import app from './worker.js';

const DEFAULT_ORIGIN='https://jesuscruz1984.github.io';
const DEFAULT_GATEWAY='default';
const BILLABLE=new Set(['/chat','/tts','/transcribe','/web-test']);
const BODY_LIMITS={
  '/chat':9_000_000,
  '/transcribe':8_000_000,
  '/tts':32_000,
  '/web-test':4_000
};

const TERRA='openai/gpt-5.6-terra';
const SOL='openai/gpt-5.6-sol';

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

function hasImageInput(input){
  try{return JSON.stringify(input||{}).includes('image_url')}catch(_){return false}
}

function openAIRequest(input,effort='low'){
  const src=input&&typeof input==='object'?input:{};
  const max=Math.min(Math.max(Number(src.max_completion_tokens||src.max_tokens||src.max_output_tokens||420),64),1600);
  const out={};
  if(Array.isArray(src.messages))out.messages=src.messages;
  else if(src.input!==undefined)out.input=src.input;
  else if(src.prompt!==undefined)out.messages=[{role:'user',content:String(src.prompt)}];
  else Object.assign(out,src);
  if(out.messages)out.max_completion_tokens=max;
  else out.max_output_tokens=max;
  if(src.tools)out.tools=src.tools;
  if(src.tool_choice)out.tool_choice=src.tool_choice;
  if(out.messages)out.reasoning_effort=effort;
  else out.reasoning={effort};
  return out;
}

function routeModel(model,input){
  // EARA hybrid brain:
  // Terra handles fast conversation, camera/vision and web fallback.
  // Sol handles the existing complex/deep reasoning path.
  if(model==='@cf/openai/gpt-oss-120b')return {model:SOL,input:openAIRequest(input,'medium')};
  if(model==='@cf/google/gemma-4-26b-a4b-it')return {model:TERRA,input:openAIRequest(input,hasImageInput(input)?'low':'low')};
  if(model==='openai/gpt-5.5')return {model:TERRA,input:openAIRequest(input,'low')};
  return {model,input};
}

function gatewayAI(env){
  const binding=env.AI;
  if(!binding||typeof binding.run!=='function')return binding;
  const gatewayId=String(env.AI_GATEWAY_ID||DEFAULT_GATEWAY).trim()||DEFAULT_GATEWAY;
  return {
    run(model,input,options={}){
      const base=options&&typeof options==='object'?options:{};
      const gateway={...(base.gateway||{}),id:gatewayId};
      const routed=routeModel(model,input);
      return binding.run(routed.model,routed.input,{...base,gateway});
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
        service:'EARA Hybrid Brain v26',
        securityConfigured:!!env.EARA_ACCESS_TOKEN,
        rateLimitConfigured:!!env.EARA_RATE_LIMITER,
        aiGatewayConfigured:!!env.AI,
        gatewayId,
        hybrid:true,
        normalModel:'gpt-5.6-terra',
        complexModel:'gpt-5.6-sol',
        routing:'Terra for fast conversation/vision/web; Sol for deep reasoning, expert and memory-heavy tasks'
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
      const response=await app.fetch(request,withGateway(env),ctx);
      return harden(response,headers);
    }catch(_){
      return json({error:'EARA request failed.'},500,headers);
    }
  }
};
