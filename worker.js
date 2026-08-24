export default {
  async fetch(request, env) {
    const allowedOrigin = env.ALLOWED_ORIGIN || "https://jesuscruz1984.github.io";
    const origin = request.headers.get("Origin") || "";
    const cors = {"Access-Control-Allow-Origin": origin === allowedOrigin ? origin : allowedOrigin,"Access-Control-Allow-Methods":"GET, POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type","Vary":"Origin"};
    if (request.method === "OPTIONS") return new Response(null,{headers:cors});
    const url = new URL(request.url);
    if (!env.AI) return j({error:"Cloudflare Workers AI binding is not configured."},500,cors);
    try {
      if (url.pathname === "/accept-llama" && request.method === "GET") {
        return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>EARA Llama License</title><style>body{font-family:-apple-system,sans-serif;background:#07111d;color:#fff;padding:28px;max-width:700px;margin:auto}button{width:100%;font-size:20px;font-weight:700;padding:18px;border:0;border-radius:14px;background:#43d2a0;color:#06130e}a{color:#57b8ff}.box{background:#101b2b;border:1px solid #27415f;border-radius:18px;padding:20px;margin:20px 0;line-height:1.5}</style><h1>EARA Vision Setup</h1><div class="box">Cloudflare requires you to agree to Meta's Llama 3.2 Community License and Acceptable Use Policy before EARA can use the vision model.<br><br><a href="https://github.com/meta-llama/llama-models/blob/main/models/llama3_2/LICENSE" target="_blank">Read Meta License</a><br><a href="https://github.com/meta-llama/llama-models/blob/main/models/llama3_2/USE_POLICY.md" target="_blank">Read Acceptable Use Policy</a></div><form method="post" action="/accept-llama"><button type="submit">I Agree — Enable EARA Vision</button></form>`,{headers:{"Content-Type":"text/html; charset=utf-8"}});
      }
      if (url.pathname === "/accept-llama" && request.method === "POST") {
        const result = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", {prompt:"agree"});
        return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,sans-serif;background:#07111d;color:#fff;padding:32px;text-align:center}.ok{font-size:64px}a{display:block;margin-top:24px;color:#57b8ff;font-size:20px}</style><div class="ok">✅</div><h1>EARA Vision Enabled</h1><p>The Llama vision license request was submitted successfully.</p><a href="https://jesuscruz1984.github.io/">Open EARA</a><pre style="white-space:pre-wrap;text-align:left;opacity:.65">${escapeHtml(JSON.stringify(result))}</pre>`,{headers:{"Content-Type":"text/html; charset=utf-8"}});
      }
      if (url.pathname === "/transcribe" && request.method === "POST") {
        const incoming = await request.formData();
        const audio = incoming.get("audio");
        if (!audio) return j({error:"Missing audio"},400,cors);
        const bytes = [...new Uint8Array(await audio.arrayBuffer())];
        const result = await env.AI.run("@cf/openai/whisper-large-v3-turbo", {audio: bytes});
        return j({text:String(result?.text || result?.result?.text || "").trim()},200,cors);
      }
      if (url.pathname === "/chat" && request.method === "POST") {
        const {text,image,memory} = await request.json();
        if (!text) return j({error:"Missing text"},400,cors);
        const system = `You are EARA, a smart hands-free AI assistant for a person wearing a camera earpiece. Answer naturally, helpfully and briefly because your answer will be spoken aloud. When an image is supplied, actually inspect it and use what you see to answer. Maintain conversational context from saved memory when useful. Recent saved memory: ${memory||"(none)"}`;
        let result;
        if (image && image.startsWith("data:image/")) {
          result = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", {messages:[{role:"system",content:system},{role:"user",content:text}],image});
        } else {
          result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {messages:[{role:"system",content:system},{role:"user",content:text}],max_tokens:300,temperature:0.5});
        }
        return j({text:extract(result)||"I couldn't generate a response."},200,cors);
      }
      return j({ok:true,service:"EARA Cloudflare Workers AI backend",provider:"Cloudflare Workers AI"},200,cors);
    } catch(e) { return j({error:String(e?.message||e)},500,cors); }
  }
};
function extract(data){if(typeof data === "string") return data.trim();return String(data?.response ?? data?.result?.response ?? data?.text ?? data?.result?.text ?? "").trim();}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}
function j(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:{...headers,"Content-Type":"application/json"}})}