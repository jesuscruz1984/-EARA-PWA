export default {
  async fetch(request, env) {
    const allowedOrigin=env.ALLOWED_ORIGIN||"https://jesuscruz1984.github.io";
    const origin=request.headers.get("Origin")||"";
    const cors={"Access-Control-Allow-Origin":origin===allowedOrigin?origin:allowedOrigin,"Access-Control-Allow-Methods":"GET, POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type","Vary":"Origin"};
    if(request.method==="OPTIONS")return new Response(null,{headers:cors});
    const url=new URL(request.url);
    if(!env.AI)return j({error:"Cloudflare Workers AI binding is not configured."},500,cors);
    try{
      if(url.pathname==="/accept-llama"&&request.method==="GET")return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>EARA Vision Setup</title><style>body{font-family:-apple-system,sans-serif;background:#07111d;color:#fff;padding:28px;max-width:700px;margin:auto}button{width:100%;font-size:20px;font-weight:700;padding:18px;border:0;border-radius:14px;background:#43d2a0;color:#06130e}a{color:#57b8ff}.box{background:#101b2b;border:1px solid #27415f;border-radius:18px;padding:20px;margin:20px 0;line-height:1.5}</style><h1>EARA Vision Setup</h1><div class="box">Cloudflare requires agreement to Meta's Llama 3.2 Community License and Acceptable Use Policy before vision can be used.</div><form method="post" action="/accept-llama"><button type="submit">I Agree — Enable EARA Vision</button></form>`,{headers:{"Content-Type":"text/html; charset=utf-8"}});
      if(url.pathname==="/accept-llama"&&request.method==="POST"){const result=await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct",{prompt:"agree"});return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,sans-serif;background:#07111d;color:#fff;padding:32px;text-align:center}a{color:#57b8ff}</style><h1>✅ EARA Vision Enabled</h1><a href="https://jesuscruz1984.github.io/">Open EARA</a><pre>${escapeHtml(JSON.stringify(result))}</pre>`,{headers:{"Content-Type":"text/html; charset=utf-8"}})}
      if(url.pathname==="/transcribe"&&request.method==="POST"){const incoming=await request.formData(),audio=incoming.get("audio");if(!audio)return j({error:"Missing audio"},400,cors);const bytes=[...new Uint8Array(await audio.arrayBuffer())];const result=await env.AI.run("@cf/openai/whisper-large-v3-turbo",{audio:bytes});return j({text:String(result?.text||result?.result?.text||"").trim()},200,cors)}
      if(url.pathname==="/tts"&&request.method==="POST"){
        const {text}=await request.json();
        if(!text)return j({error:"Missing text"},400,cors);
        const result=await env.AI.run("@cf/myshell-ai/melotts",{prompt:String(text).slice(0,2200),lang:"en"});
        let audio=result?.audio??result;
        if(audio instanceof Response)audio=await audio.arrayBuffer();
        if(audio instanceof ReadableStream)audio=await new Response(audio).arrayBuffer();
        let b64="";
        if(typeof audio==="string"){
          const clean=audio.replace(/\s+/g,"");
          b64=/^[A-Za-z0-9+/=]+$/.test(clean)&&clean.length>80?clean:btoa(audio);
        }else if(audio instanceof ArrayBuffer)b64=bytesToBase64(new Uint8Array(audio));
        else if(ArrayBuffer.isView(audio))b64=bytesToBase64(new Uint8Array(audio.buffer,audio.byteOffset,audio.byteLength));
        if(!b64)return j({error:"TTS returned no playable audio."},500,cors);
        return j({audio:b64,mime:"audio/mpeg"},200,cors);
      }
      if(url.pathname==="/chat"&&request.method==="POST"){
        const {text,image,memory,personality}=await request.json();if(!text)return j({error:"Missing text"},400,cors);
        const styles={helpful:"Be broadly helpful, practical, warm, and clear.",concise:"Be extremely concise and action-oriented. Prefer short direct answers.",expert:"Act as a rigorous expert analyst. Explain technical details precisely and call out uncertainty.",companion:"Be friendly, conversational, supportive, and natural while still useful.",fieldtech:"Think like an experienced field technician. Prioritize troubleshooting steps, safety, equipment details, and practical fixes.",observer:"Act like a curious observational agent. Notice useful visual/environmental details and connect them to prior memory."};
        const style=styles[personality]||styles.helpful;
        const system=`You are EARA, an ACTIVE real-time hands-free AI assistant inside a live camera-and-microphone app. You are conversing with the user right now. The user's speech is transcribed and sent to you, so you CAN hear and respond through EARA. When an image is supplied, you CAN inspect the current camera frame. Never say you are a one-way tool, cannot reply, cannot converse in real time, cannot hear the user, or cannot respond to messages. Those statements are false for this app. ${style} Answer naturally and directly because your reply is spoken aloud. When an image is supplied, inspect it carefully and use what you actually see. Use the memory below to recall prior questions, answers, people, objects, places, links, and visual observations when relevant. Do not claim you forgot something if it is present in memory. This build does not yet have live web browsing; only if the user specifically asks for current online/web results, state that limitation in one short sentence and then still help as much as possible.\n\nEARA MEMORY:\n${memory||"(no stored memory yet)"}`;
        let result;
        if(image&&image.startsWith("data:image/"))result=await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct",{messages:[{role:"system",content:system},{role:"user",content:text}],image});
        else result=await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast",{messages:[{role:"system",content:system},{role:"user",content:text}],max_tokens:400,temperature:0.45});
        return j({text:extract(result)||"I couldn't generate a response."},200,cors)
      }
      return j({ok:true,service:"EARA Cloudflare Workers AI backend",provider:"Cloudflare Workers AI"},200,cors)
    }catch(e){return j({error:String(e?.message||e)},500,cors)}
  }
};
function bytesToBase64(bytes){let out="";const step=0x8000;for(let i=0;i<bytes.length;i+=step)out+=String.fromCharCode(...bytes.subarray(i,i+step));return btoa(out)}
function extract(d){if(typeof d==="string")return d.trim();return String(d?.response??d?.result?.response??d?.text??d?.result?.text??"").trim()}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}
function j(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:{...headers,"Content-Type":"application/json","Cache-Control":"no-store"}})}