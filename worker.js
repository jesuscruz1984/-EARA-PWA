export default {
  async fetch(request, env) {
    const allowedOrigin = env.ALLOWED_ORIGIN || "https://jesuscruz1984.github.io";
    const origin = request.headers.get("Origin") || "";
    const cors = {"Access-Control-Allow-Origin": origin === allowedOrigin ? origin : allowedOrigin,"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type","Vary":"Origin"};
    if (request.method === "OPTIONS") return new Response(null,{headers:cors});
    const url = new URL(request.url);
    const key = env.GEMINI_API_KEY || env.Gemini_API_Key || env.Gemini_API_KEY || env.gemini_api_key;
    if (!key) return j({error:"Gemini API key is not configured. Expected GEMINI_API_KEY or Gemini_API_Key."},500,cors);
    try {
      if (url.pathname === "/transcribe" && request.method === "POST") {
        const incoming = await request.formData();
        const audio = incoming.get("audio");
        if (!audio) return j({error:"Missing audio"},400,cors);
        const bytes = new Uint8Array(await audio.arrayBuffer());
        let binary = "";
        for (let i=0;i<bytes.length;i+=0x8000) binary += String.fromCharCode(...bytes.subarray(i,i+0x8000));
        const base64 = btoa(binary);
        const data = await gemini(key,[{text:"Transcribe this speech accurately. Return only the words spoken, with no commentary."},{inlineData:{mimeType:audio.type || "audio/mp4",data:base64}}]);
        return j({text:extract(data)},200,cors);
      }
      if (url.pathname === "/chat" && request.method === "POST") {
        const {text,image,memory} = await request.json();
        if (!text) return j({error:"Missing text"},400,cors);
        const parts=[{text:`You are EARA, a smart hands-free AI assistant for a person wearing a camera earpiece. Answer naturally, helpfully and briefly because your answer will be spoken aloud. When an image is supplied, actually inspect it and use what you see to answer. Maintain conversational context from the saved memory when useful.\n\nRecent saved memory:\n${memory||"(none)"}\n\nUser: ${text}`}];
        if (image && image.startsWith("data:image/")) { const m=image.match(/^data:(image\/[^;]+);base64,(.+)$/); if(m) parts.push({inlineData:{mimeType:m[1],data:m[2]}}); }
        const data=await gemini(key,parts);
        return j({text:extract(data)||"I couldn't generate a response."},200,cors);
      }
      return j({ok:true,service:"EARA Gemini backend",secretNameDetected:key===env.GEMINI_API_KEY?"GEMINI_API_KEY":key===env.Gemini_API_Key?"Gemini_API_Key":"alternate"},200,cors);
    } catch(e) { return j({error:String(e?.message||e)},500,cors); }
  }
};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function callModel(key,model,parts){
  const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify({contents:[{role:"user",parts}],generationConfig:{maxOutputTokens:300,temperature:0.5}})});
  const data=await r.json();
  if(r.ok) return data;
  const msg=data?.error?.message || JSON.stringify(data);
  const retryable=r.status===429 || r.status===500 || r.status===502 || r.status===503 || /high demand|overloaded|temporar|unavailable|resource exhausted/i.test(msg);
  const err=new Error(msg); err.retryable=retryable; throw err;
}
async function gemini(key,parts){
  const models=["gemini-3.7-flash","gemini-2.5-flash"];
  let last;
  for(const model of models){
    for(let attempt=0;attempt<3;attempt++){
      try{return await callModel(key,model,parts)}catch(e){last=e;if(!e.retryable)break;if(attempt<2)await sleep(500*(attempt+1));}
    }
  }
  throw last || new Error("Gemini is temporarily unavailable");
}
function extract(data){return (data?.candidates?.[0]?.content?.parts||[]).map(p=>p.text||"").join("").trim()}
function j(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:{...headers,"Content-Type":"application/json"}})}