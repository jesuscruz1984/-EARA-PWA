export default {
  async fetch(request, env) {
    const allowedOrigin = env.ALLOWED_ORIGIN || "https://jesuscruz1984.github.io";
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": origin === allowedOrigin ? origin : allowedOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(request.url);
    if (!env.AI) return j({ error: "Cloudflare Workers AI binding is not configured." }, 500, cors);

    try {
      if (url.pathname === "/health") {
        return j({
          ok: true,
          mode: "Auto Smart + Gemini Backup",
          normal: "@cf/zai-org/glm-4.7-flash",
          deep: "@cf/openai/gpt-oss-120b",
          vision: "@cf/meta/llama-3.2-11b-vision-instruct",
          webPrimary: "Tavily",
          geminiBackup: "gemini-3.1-flash-lite",
          geminiConfigured: !!geminiKey(env),
          tavilyConfigured: !!env.TAVILY_API_KEY,
          voice: "free device voice default; Aura optional"
        }, 200, cors);
      }

      if (url.pathname === "/web-test" && request.method === "GET") {
        if (!env.TAVILY_API_KEY) return j({ ok: false, error: "TAVILY_API_KEY is not configured." }, 503, cors);
        try {
          const data = await tavilySearchRaw(env.TAVILY_API_KEY, "OpenAI official website");
          return j({ ok: true, provider: "Tavily", results: (data.results || []).slice(0, 2).map(x => ({ title: x.title, url: x.url })), usage: data.usage || null }, 200, cors);
        } catch (e) {
          return j({ ok: false, provider: "Tavily", error: String(e?.message || e) }, 502, cors);
        }
      }

      if (url.pathname === "/accept-llama" && request.method === "GET") {
        return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>EARA Vision Setup</title><style>body{font-family:-apple-system,sans-serif;background:#07111d;color:#fff;padding:28px;max-width:700px;margin:auto}button{width:100%;font-size:20px;font-weight:700;padding:18px;border:0;border-radius:14px;background:#43d2a0;color:#06130e}</style><h1>EARA Vision Setup</h1><form method="post" action="/accept-llama"><button type="submit">I Agree — Enable EARA Vision</button></form>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      if (url.pathname === "/accept-llama" && request.method === "POST") {
        const result = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", { prompt: "agree" });
        return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,sans-serif;background:#07111d;color:#fff;padding:32px;text-align:center}a{color:#57b8ff}</style><h1>✅ EARA Vision Enabled</h1><a href="https://jesuscruz1984.github.io/">Open EARA</a><pre>${escapeHtml(JSON.stringify(result))}</pre>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }

      if (url.pathname === "/transcribe" && request.method === "POST") {
        const incoming = await request.formData();
        const audio = incoming.get("audio");
        if (!audio) return j({ error: "Missing audio" }, 400, cors);
        const bytes = [...new Uint8Array(await audio.arrayBuffer())];
        try {
          const result = await env.AI.run("@cf/openai/whisper-large-v3-turbo", { audio: bytes });
          return j({ text: String(result?.text || result?.result?.text || "").trim() }, 200, cors);
        } catch (e) {
          if (isQuotaError(e)) return j({ error: "Daily Cloudflare transcription allowance reached. Browser Hey Robot recognition can still be used." }, 429, cors);
          throw e;
        }
      }

      if (url.pathname === "/tts" && request.method === "POST") {
        const { text, speaker } = await request.json();
        if (!text) return j({ error: "Missing text" }, 400, cors);
        const spoken = makeSpeech(text);
        if (!spoken) return j({ error: "Nothing to speak" }, 400, cors);
        const allowed = new Set(["angus", "asteria", "arcas", "orion", "orpheus", "athena", "luna", "zeus", "perseus", "helios", "hera", "stella"]);
        const voice = allowed.has(String(speaker || "").toLowerCase()) ? String(speaker).toLowerCase() : "asteria";
        try {
          const raw = await env.AI.run("@cf/deepgram/aura-1", { text: spoken.slice(0, 220), speaker: voice, encoding: "mp3" }, { returnRawResponse: true });
          let audio;
          if (raw instanceof Response) audio = await raw.arrayBuffer();
          else if (raw instanceof ArrayBuffer) audio = raw;
          else if (ArrayBuffer.isView(raw)) audio = raw.buffer;
          else if (raw?.audio && typeof raw.audio === "string") return j({ audio: raw.audio, mime: "audio/mpeg", speaker: voice, spoken }, 200, cors);
          if (!audio) return j({ error: "Aura returned no playable audio." }, 500, cors);
          return j({ audio: bytesToBase64(new Uint8Array(audio)), mime: "audio/mpeg", speaker: voice, spoken }, 200, cors);
        } catch (e) {
          if (isQuotaError(e)) return j({ error: "Premium voice daily Cloudflare allowance reached. Select a FREE iPhone voice." }, 429, cors);
          throw e;
        }
      }

      if (url.pathname === "/chat" && request.method === "POST") {
        const { text, image, memory, personality, source } = await request.json();
        if (!text) return j({ error: "Missing text" }, 400, cors);

        const styles = {
          helpful: "Be broadly helpful, practical, warm, and clear.",
          concise: "Be extremely concise and action-oriented. Prefer short direct answers.",
          expert: "Act as a rigorous expert analyst. Explain technical details precisely and call out uncertainty.",
          companion: "Be friendly, conversational, supportive, and natural while still useful.",
          fieldtech: "Think like an experienced field technician. Prioritize troubleshooting steps, safety, equipment details, and practical fixes.",
          observer: "Act like a curious observational agent. Notice useful visual/environmental details and connect them to prior memory."
        };
        const style = styles[personality] || styles.helpful;
        const safeMemory = String(memory || "(no stored memory yet)")
          .replace(/EARA:.*(?:large language model|cannot visually|can't visually|cannot see|can't see|one-way communication|text-based inputs only).*/gi, "EARA: [obsolete capability statement ignored]")
          .slice(-7000);
        const hasImage = typeof image === "string" && image.startsWith("data:image/");
        const wantsWeb = isWebIntent(text);
        const wantsDeep = isDeepIntent(text, personality);
        const gKey = geminiKey(env);
        const system = `You are EARA, an active real-time voice, memory, camera and live-web assistant. You are talking with the user right now. ${style} Never claim you are only a text model, one-way tool, unable to converse, unable to see when visual input is provided, or fundamentally unable to search online. Be accurate and practical. Put useful detail, prices, links and supporting information in the on-screen answer; EARA separately creates a short spoken summary. Use memory only when relevant.\n\nEARA MEMORY:\n${safeMemory}`;

        const instant = instantAnswer(text);
        if (instant && !hasImage && !wantsWeb) {
          return chatReply(instant, { visionUsed: false, webUsed: false, model: "EARA local", modelMode: "local" }, cors);
        }

        let scene = "";
        let visionError = "";
        let visionProvider = "";
        if (hasImage) {
          const kind = source === "screen" ? "shared screen" : "live camera frame";
          try {
            const vision = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", {
              messages: [
                { role: "system", content: `Inspect the attached ${kind} carefully. Identify the important visible object, text, brand, model number, color, state, warning, screen content or action needed for the user's request. Be concise and factual. Do not discuss AI limitations.` },
                { role: "user", content: `User request: ${text}` }
              ],
              image,
              max_tokens: 180,
              temperature: 0.15
            });
            scene = extract(vision);
            visionProvider = "Cloudflare Vision";
          } catch (e) {
            visionError = String(e?.message || e);
            if (isQuotaError(e) && gKey) {
              try {
                scene = await geminiGenerate(gKey, `You are EARA's visual perception backup. Inspect this ${kind} and identify only what matters for the user's request. Be concise and factual. User request: ${text}`, image, 260);
                visionProvider = "Gemini Vision Backup";
                visionError = "";
              } catch (ge) {
                visionError = `Cloudflare vision: ${visionError}; Gemini vision: ${String(ge?.message || ge)}`;
              }
            } else if (!isQuotaError(e)) {
              throw e;
            }
          }
        }

        if (wantsWeb) {
          const query = buildSearchQuery(text, scene);
          let tavilyError = "";
          if (env.TAVILY_API_KEY) {
            try {
              const data = await tavilySearchRaw(env.TAVILY_API_KEY, query);
              const tr = formatTavilyResults(data);
              if (tr) {
                const synthesisPrompt = `${system}\n\nUSER REQUEST:\n${text}\n\n${scene ? `VISUAL OBSERVATION (${visionProvider || "vision"}):\n${scene}\n\n` : ""}CURRENT TAVILY RESULTS:\n${tr}\n\nUse these fresh web results as current evidence. Answer directly. Include useful prices, seller/store names, and the best direct URLs. Never say you cannot search online.`;
                try {
                  const synth = await env.AI.run("@cf/zai-org/glm-4.7-flash", {
                    messages: [{ role: "user", content: synthesisPrompt }],
                    max_tokens: 420,
                    temperature: 0.25
                  });
                  const a = extract(synth);
                  if (a) return chatReply(a, { visionUsed: !!scene, webUsed: true, webProvider: "Tavily", model: "@cf/zai-org/glm-4.7-flash", modelMode: "auto", visionProvider, visionError: visionError || undefined }, cors);
                } catch (e) {
                  if (isQuotaError(e) && gKey) {
                    try {
                      const a = await geminiGenerate(gKey, synthesisPrompt, null, 650);
                      if (a) return chatReply(a, { visionUsed: !!scene, webUsed: true, webProvider: "Tavily", model: "gemini-3.1-flash-lite", modelMode: "gemini-backup", visionProvider, visionError: visionError || undefined }, cors);
                    } catch (_) {}
                  }
                  return chatReply(formatTavilyDirect(data, text, !!scene, visionError), {
                    visionUsed: !!scene,
                    webUsed: true,
                    webProvider: "Tavily direct",
                    model: "Tavily",
                    modelMode: "web-direct",
                    aiLimited: isQuotaError(e),
                    visionProvider,
                    visionError: visionError || undefined
                  }, cors);
                }
              }
            } catch (e) {
              tavilyError = String(e?.message || e);
            }
          } else {
            tavilyError = "TAVILY_API_KEY missing";
          }

          try {
            const searchPrompt = `${system}\n\n${scene ? `VISUAL OBSERVATION:\n${scene}\n\n` : ""}USER REQUEST:\n${text}\n\nUse live web search. Give current concrete results with useful direct URLs. Never say you cannot browse.`;
            const web = await env.AI.run("openai/gpt-5.5", { input: searchPrompt, max_output_tokens: 550, tools: [{ type: "web_search_preview" }], reasoning: { effort: "low" } }, { gateway: { id: env.AI_GATEWAY_ID || "default" } });
            const webAnswer = extract(web);
            if (webAnswer) return chatReply(webAnswer, { visionUsed: !!scene, webUsed: true, webProvider: "Cloudflare AI Gateway", model: "openai/gpt-5.5", modelMode: "web", visionProvider }, cors);
          } catch (_) {}

          return chatReply(`Live search hit a temporary connection issue. Try that search again.${tavilyError ? "" : ""}`, { visionUsed: !!scene, webUsed: false, modelMode: "fallback", visionProvider, visionError: visionError || undefined }, cors);
        }

        const userContext = `${scene ? `CURRENT ${source === "screen" ? "SHARED SCREEN" : "CAMERA"} OBSERVATION (${visionProvider || "vision"}):\n${scene}\n\n` : ""}USER:\n${text}`;
        const primary = wantsDeep ? "@cf/openai/gpt-oss-120b" : "@cf/zai-org/glm-4.7-flash";
        try {
          const result = await env.AI.run(primary, {
            messages: [
              { role: "system", content: system + (scene ? "\nA current visual observation is included. Treat it as what EARA sees now." : "") },
              { role: "user", content: userContext }
            ],
            max_tokens: wantsDeep ? 500 : 320,
            temperature: wantsDeep ? 0.35 : 0.45
          });
          let answer = extract(result);
          if (scene && isFalseVisionRefusal(answer)) answer = scene || answer;
          return chatReply(answer || "I couldn't generate a response.", { visionUsed: !!scene, webUsed: false, model: primary, modelMode: wantsDeep ? "deep" : "auto", visionProvider }, cors);
        } catch (e) {
          if (wantsDeep && !isQuotaError(e)) {
            try {
              const light = await env.AI.run("@cf/zai-org/glm-4.7-flash", { messages: [{ role: "system", content: system }, { role: "user", content: userContext }], max_tokens: 320, temperature: 0.4 });
              return chatReply(extract(light) || "I couldn't generate a response.", { visionUsed: !!scene, webUsed: false, model: "@cf/zai-org/glm-4.7-flash", modelMode: "auto-fallback", visionProvider }, cors);
            } catch (e2) {
              e = e2;
            }
          }

          if (gKey) {
            try {
              const geminiPrompt = `${system}\n\n${userContext}\n\nRespond as EARA. Keep the spoken takeaway concise, but the on-screen answer can contain useful detail.`;
              const answer = await geminiGenerate(gKey, geminiPrompt, hasImage && !scene ? image : null, wantsDeep ? 800 : 520);
              if (answer) return chatReply(answer, { visionUsed: !!scene || hasImage, webUsed: false, model: "gemini-3.1-flash-lite", modelMode: "gemini-backup", visionProvider: visionProvider || (hasImage ? "Gemini" : undefined), cloudflareLimited: isQuotaError(e) }, cors);
            } catch (ge) {
              if (env.TAVILY_API_KEY && isLikelyFactual(text)) {
                try {
                  const data = await tavilySearchRaw(env.TAVILY_API_KEY, text);
                  return chatReply(formatTavilyDirect(data, text, false, ""), { webUsed: true, webProvider: "Tavily direct fallback", model: "Tavily", modelMode: "web-direct", geminiError: String(ge?.message || ge) }, cors);
                } catch (_) {}
              }
              return chatReply("Cloudflare's free AI allowance is used up and the Gemini backup is temporarily unavailable. Web searches can still use Tavily. Try again shortly or ask me to search the web.", { visionUsed: false, webUsed: false, aiLimited: true, modelMode: "limit", geminiError: String(ge?.message || ge) }, cors);
            }
          }

          if (env.TAVILY_API_KEY && isLikelyFactual(text)) {
            try {
              const data = await tavilySearchRaw(env.TAVILY_API_KEY, text);
              return chatReply(formatTavilyDirect(data, text, false, ""), { webUsed: true, webProvider: "Tavily direct fallback", model: "Tavily", modelMode: "web-direct" }, cors);
            } catch (_) {}
          }
          if (isQuotaError(e)) return chatReply("Cloudflare's free AI allowance is used up. Add or restore the Gemini backup key for uninterrupted normal conversation; Tavily web search remains available.", { visionUsed: false, webUsed: false, aiLimited: true, modelMode: "limit" }, cors);
          throw e;
        }
      }

      return j({ ok: true, service: "EARA Auto Smart backend", normal: "GLM-4.7-Flash", deep: "GPT-OSS 120B", backup: "Gemini 3.1 Flash-Lite", web: "Tavily primary", voice: "device free / Aura optional" }, 200, cors);
    } catch (e) {
      return j({ error: String(e?.message || e) }, 500, cors);
    }
  }
};

function geminiKey(env) {
  return env.GEMINI_API_KEY || env.Gemini_API_Key || env.GEMINI_API_Key || env.Gemini_API_KEY || "";
}

async function geminiGenerate(key, prompt, imageDataUrl = null, maxOutputTokens = 520) {
  if (!key) throw new Error("Gemini API key missing");
  const parts = [];
  if (imageDataUrl) {
    const m = String(imageDataUrl).match(/^data:(image\/[^;]+);base64,(.+)$/s);
    if (m) parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
  }
  parts.push({ text: String(prompt || "") });
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { temperature: 0.35, maxOutputTokens } })
  });
  const raw = await r.text();
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${raw.slice(0, 400)}`);
  let d;
  try { d = JSON.parse(raw); } catch (_) { throw new Error("Gemini returned invalid JSON"); }
  const out = (d.candidates?.[0]?.content?.parts || []).map(p => p?.text || "").join("\n").trim();
  if (!out) throw new Error(`Gemini returned no text${d.promptFeedback?.blockReason ? `: ${d.promptFeedback.blockReason}` : ""}`);
  return out;
}

function instantAnswer(s) {
  const q = String(s || "").trim().toLowerCase();
  if (/^(?:hey\s+robot[, ]*)?(?:can you hear me|do you hear me|are you listening|can you hear)$/i.test(q)) return "Yes. I can hear you through EARA's microphone and speech-recognition pipeline.";
  if (/^(?:hey\s+robot[, ]*)?(?:hello|hi|hey|are you there|you there)[!.? ]*$/i.test(q)) return "Yes, I'm here and listening.";
  if (/^(?:thanks|thank you|thx)[!.? ]*$/i.test(q)) return "You're welcome.";
  return "";
}

function chatReply(text, meta, cors) {
  const full = String(text || "").trim();
  return j({ text: full, speech: makeSpeech(full, !!meta?.webUsed), ...meta }, 200, cors);
}

function makeSpeech(input, web = false) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const hadLink = /(?:https?:\/\/|www\.)/i.test(raw);
  const price = (raw.match(/\$\s?\d[\d,]*(?:\.\d{1,2})?/) || [])[0];
  let clean = raw.replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)]+\)/gi, "$1").replace(/(?:https?:\/\/|www\.)\S+/gi, "").replace(/[\*_`#>|]+/g, " ").replace(/^\s*\d+[.)]\s*/gm, "").replace(/^\s*[-•]\s*/gm, "").replace(/\s+/g, " ").trim();
  let first = (clean.match(/[^.!?]+[.!?]+|[^.!?]+$/) || [clean])[0].trim().replace(/[:;,\-\s]+$/, ".");
  if (!first || first.length < 3) first = "I found the information.";
  if (first.length > 135) { first = first.slice(0, 135); const cut = first.lastIndexOf(" "); if (cut > 90) first = first.slice(0, cut); first = first.replace(/[,;:\-\s]+$/, "."); }
  if ((web || hadLink) && price && !first.includes(price)) first += ` One price I found is ${price.replace(/\s+/g, "")}.`;
  if (web || hadLink) first += " The links and full details are on screen.";
  return first.replace(/\s+/g, " ").trim().slice(0, 210);
}

function isWebIntent(s) { return /\b(search|search for|look up|lookup|find|locate|show me where|online|internet|web|amazon|ebay|walmart|best buy|buy|purchase|order|price|cost|deal|seller|store|where can i get|where can i buy|where do i get|link|website|latest|current|today|news|weather|stock price|score|near me|open now|available|availability)\b/i.test(String(s || "")); }
function isLikelyFactual(s) { return /\b(what|who|when|where|why|how|which|define|explain|tell me about|information|spec|model|manual|part number|price|cost)\b/i.test(String(s || "")); }
function isDeepIntent(s, personality) { if (personality === "expert") return true; return /\b(deep|detailed|in depth|analy[sz]e|analysis|diagnos|troubleshoot|engineering|technical calculation|calculate|complex|reason carefully|compare thoroughly|research deeply|step by step technical|root cause)\b/i.test(String(s || "")); }
function buildSearchQuery(text, scene) { const t = String(text || "").trim(); const s = String(scene || "").trim(); return s ? `${t}\nIdentify/search using these visible details: ${s}` : t; }

async function tavilySearchRaw(key, query) {
  const r = await fetch("https://api.tavily.com/search", { method: "POST", headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ query, search_depth: "basic", max_results: 6, include_answer: false, include_raw_content: false, include_images: false, safe_search: true }) });
  const text = await r.text();
  if (!r.ok) throw new Error(`Tavily ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}
function formatTavilyResults(d) { return (d?.results || []).map((x, i) => `${i + 1}. ${x.title || "Result"}\n${x.url || ""}\n${x.content || ""}`).join("\n\n"); }
function formatTavilyDirect(d, request, hadScene, visionError) { const rows = (d?.results || []).slice(0, 5); if (!rows.length) return "I couldn't find a useful live result for that search."; const intro = hadScene ? "I searched using the visible item details. Here are the best live results:" : "Here are the best live results I found:"; const body = rows.map((x, i) => `${i + 1}. ${x.title || "Result"}${x.content ? `\n${String(x.content).slice(0, 240)}` : ""}\n${x.url || ""}`).join("\n\n"); const note = visionError ? "\n\nCamera identification was limited, so verify the exact model before buying." : ""; return `${intro}\n\n${body}${note}`; }
function isQuotaError(e) { return /(?:4006|10,000 neurons|daily free allocation|used up your daily|Workers Paid plan)/i.test(String(e?.message || e)); }
function isFalseVisionRefusal(s) { return /(?:can(?:not|'t) (?:visually )?(?:see|observe|view|access)|do not have (?:the )?capability to (?:visually )?(?:see|observe)|text-based inputs only|large language model.*(?:see|visual))/i.test(String(s || "")); }
function bytesToBase64(bytes) { let out = ""; const step = 0x8000; for (let i = 0; i < bytes.length; i += step) out += String.fromCharCode(...bytes.subarray(i, i + step)); return btoa(out); }
function extract(d) { if (typeof d === "string") return d.trim(); if (d?.output_text) return String(d.output_text).trim(); if (d?.response) return String(d.response).trim(); if (d?.result?.response) return String(d.result.response).trim(); if (d?.text) return String(d.text).trim(); if (d?.choices?.[0]?.message?.content) return String(d.choices[0].message.content).trim(); if (Array.isArray(d?.output)) { const parts = []; for (const item of d.output) for (const c of item?.content || []) if (c?.text) parts.push(c.text); if (parts.length) return parts.join("\n").trim(); } return ""; }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function j(data, status = 200, headers = {}) { return new Response(JSON.stringify(data), { status, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" } }); }
