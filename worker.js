export default {
  async fetch(request, env) {
    const allowedOrigin = env.ALLOWED_ORIGIN || "https://jesuscruz1984.github.io";
    const origin = request.headers.get("Origin") || "";
    const cors = {"Access-Control-Allow-Origin": origin === allowedOrigin ? origin : allowedOrigin,"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type","Vary":"Origin"};
    if (request.method === "OPTIONS") return new Response(null,{headers:cors});
    const url = new URL(request.url);
    if (!env.AI) return j({error:"Cloudflare Workers AI binding is not configured."},500,cors);
    try {
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
          result = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", {
            messages:[{role:"system",content:system},{role:"user",content:text}],
            image
          });
        } else {
          result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
            messages:[{role:"system",content:system},{role:"user",content:text}],
            max_tokens:300,
            temperature:0.5
          });
        }
        return j({text:extract(result)||"I couldn't generate a response."},200,cors);
      }
      return j({ok:true,service:"EARA Cloudflare Workers AI backend",provider:"Cloudflare Workers AI"},200,cors);
    } catch(e) { return j({error:String(e?.message||e)},500,cors); }
  }
};
function extract(data){
  if(typeof data === "string") return data.trim();
  return String(data?.response ?? data?.result?.response ?? data?.text ?? data?.result?.text ?? "").trim();
}
function j(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:{...headers,"Content-Type":"application/json"}})}
