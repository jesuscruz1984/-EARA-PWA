export default {
  async fetch(request, env) {
    const allowedOrigin = env.ALLOWED_ORIGIN || "https://jesuscruz1984.github.io";
    const origin = request.headers.get("Origin") || "";
    const cors = {"Access-Control-Allow-Origin": origin === allowedOrigin ? origin : allowedOrigin,"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type","Vary":"Origin"};
    if (request.method === "OPTIONS") return new Response(null,{headers:cors});
    if (!env.OPENAI_API_KEY) return j({error:"OPENAI_API_KEY is not configured"},500,cors);
    const url = new URL(request.url);
    try {
      if (url.pathname === "/transcribe" && request.method === "POST") {
        const incoming = await request.formData(); const audio = incoming.get("audio");
        if (!audio) return j({error:"Missing audio"},400,cors);
        const form = new FormData(); form.append("model","gpt-transcribe"); form.append("file",audio,audio.name||"speech.m4a");
        const r = await fetch("https://api.openai.com/v1/audio/transcriptions",{method:"POST",headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`},body:form});
        return new Response(await r.text(),{status:r.status,headers:{...cors,"Content-Type":"application/json"}});
      }
      if (url.pathname === "/chat" && request.method === "POST") {
        const {text,image,memory} = await request.json(); if (!text) return j({error:"Missing text"},400,cors);
        const content=[{type:"input_text",text:`You are EARA, a concise hands-free AI assistant for a person wearing an AI camera earpiece. Speak naturally and briefly because your answer will be read aloud. Use the camera image when relevant. Recent saved memory:\n${memory||"(none)"}\n\nUser: ${text}`}];
        if (image && image.startsWith("data:image/")) content.push({type:"input_image",image_url:image,detail:"low"});
        const r=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-5.4-mini",input:[{role:"user",content}],max_output_tokens:220})});
        const data=await r.json(); if(!r.ok) return j(data,r.status,cors);
        let out=data.output_text||""; if(!out&&Array.isArray(data.output)) for(const item of data.output||[]) for(const part of item.content||[]) if(part.type==="output_text") out+=part.text||"";
        return j({text:out||"I couldn't generate a response."},200,cors);
      }
      return j({ok:true,service:"EARA backend"},200,cors);
    } catch(e) { return j({error:String(e?.message||e)},500,cors); }
  }
};
function j(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:{...headers,"Content-Type":"application/json"}})}