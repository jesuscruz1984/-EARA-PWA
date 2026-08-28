import app from './agent-wrapper-v4.js';

const FLUX='@cf/black-forest-labs/flux-1-schnell';
const ORIGIN='https://jesuscruz1984.github.io';

function wantsImage(text){
  return /\b(generate|create|make|draw|design|render|illustrate)\b[\s\S]{0,55}\b(image|picture|photo|logo|icon|poster|graphic|art|illustration|mockup|wallpaper)\b|\b(image|picture|photo|logo|icon|poster|graphic|art|illustration|mockup|wallpaper)\b[\s\S]{0,45}\b(generate|create|make|draw|design|render)\b/i.test(String(text||''));
}
function headers(origin){
  const h=new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  if(origin===ORIGIN)h.set('Access-Control-Allow-Origin',ORIGIN);
  return h;
}
function safeError(e){
  const s=String(e?.message||e||'Image model failed').replace(/[\r\n]+/g,' ').slice(0,500);
  return s.replace(/(?:Bearer|token|secret|key)\s*[:=]\s*[^\s,;]+/gi,'credential=[redacted]');
}
async function imageResponse(env,body){
  const prompt=String(body?.text||'').trim().slice(0,2048);
  const result=await env.AI.run(FLUX,{prompt,steps:6,seed:Math.floor(Math.random()*2147483646)+1});
  if(!result?.image)throw new Error('Image model returned no image');
  const image=`data:image/jpeg;base64,${result.image}`;
  return {
    text:'Done — I created the image.',
    speech:'Done. I created the image.',
    images:[image],
    toolsUsed:['image_generation'],
    model:FLUX,
    route:'workers-ai-image-direct',
    agentFallback:false
  };
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==='/agent-chat'&&request.method==='POST'){
      let body=null;
      try{body=await request.clone().json()}catch(_){body=null}
      if(body&&wantsImage(body.text)&&!body.image){
        try{
          const data=await imageResponse(env,body);
          return new Response(JSON.stringify(data),{status:200,headers:headers(request.headers.get('Origin')||'')});
        }catch(e){
          const err=safeError(e);
          return new Response(JSON.stringify({
            text:'Image generation is temporarily unavailable.',
            speech:'Image generation is temporarily unavailable.',
            images:[],
            route:'workers-ai-image-error',
            model:FLUX,
            imageError:err
          }),{status:503,headers:headers(request.headers.get('Origin')||'')});
        }
      }
    }
    return app.fetch(request,env,ctx);
  }
};
