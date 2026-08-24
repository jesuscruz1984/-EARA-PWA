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
          reasoning: "@cf/openai/gpt-oss-120b",
          vision: "@cf/meta/llama-3.2-11b-vision-instruct",
          tts: "@cf/deepgram/aura-1",
          webPrimary: "Tavily direct results",
          tavilyConfigured: !!env.TAVILY_API_KEY
        }, 200, cors);
      }

      if (url.pathname === "/web-test" && request.method === "GET") {
        if (!env.TAVILY_API_KEY) return j({ ok: false, error: "TAVILY_API_KEY is not configured." }, 503, cors);
        try {
          const data = await tavilySearchRaw(env.TAVILY_API_KEY, "OpenAI official website");
          return j({
            ok: true,
            provider: "Tavily",
            results: (data.results || []).slice(0, 2).map(x => ({ title: x.title, url: x.url })),
            usage: data.usage || null
          }, 200, cors);
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
        const result = await env.AI.run("@cf/openai/whisper-large-v3-turbo", { audio: bytes });
        return j({ text: String(result?.text || result?.result?.text || "").trim() }, 200, cors);
      }

      if (url.pathname === "/tts" && request.method === "POST") {
        const { text, speaker } = await request.json();
        if (!text) return j({ error: "Missing text" }, 400, cors);
        const spoken = makeSpeech(text);
        if (!spoken) return j({ error: "Nothing to speak" }, 400, cors);

        const allowed = new Set(["angus", "asteria", "arcas", "orion", "orpheus", "athena", "luna", "zeus", "perseus", "helios", "hera", "stella"]);
        const voice = allowed.has(String(speaker || "").toLowerCase()) ? String(speaker).toLowerCase() : "asteria";
        const raw = await env.AI.run("@cf/deepgram/aura-1", { text: spoken.slice(0, 220), speaker: voice, encoding: "mp3" }, { returnRawResponse: true });
        let audio;
        if (raw instanceof Response) audio = await raw.arrayBuffer();
        else if (raw instanceof ArrayBuffer) audio = raw;
        else if (ArrayBuffer.isView(raw)) audio = raw.buffer;
        else if (raw?.audio && typeof raw.audio === "string") return j({ audio: raw.audio, mime: "audio/mpeg", speaker: voice, spoken }, 200, cors);
        if (!audio) return j({ error: "Aura returned no playable audio." }, 500, cors);
        return j({ audio: bytesToBase64(new Uint8Array(audio)), mime: "audio/mpeg", speaker: voice, spoken }, 200, cors);
      }

      if (url.pathname === "/chat" && request.method === "POST") {
        const { text, image, memory, personality } = await request.json();
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
          .slice(-9000);

        const hasImage = typeof image === "string" && image.startsWith("data:image/");
        const wantsWeb = isWebIntent(text);
        const system = `You are EARA, an active real-time camera, voice, memory and live-web assistant. You are talking with the user right now. ${style} Never reveal hidden reasoning, planning, tool-call notes, search steps, chain-of-thought, or phrases such as "Search web", "Search query", "Open", "We need to", "Let's verify", or "Now craft answer". Give only the finished answer. Never claim you are only a text model, one-way tool, unable to converse, or fundamentally unable to search online. Keep useful details on screen while EARA separately speaks a short summary.\n\nEARA MEMORY:\n${safeMemory}`;

        let scene = "";
        if (hasImage) {
          const vision = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", {
            messages: [
              { role: "system", content: "Inspect this live camera frame. Return only a concise factual identification of the important visible item, text, brand, title, model number, color, or other details useful for the user's request. No reasoning or AI limitations." },
              { role: "user", content: `User request: ${text}` }
            ],
            image,
            max_tokens: 220,
            temperature: 0.15
          });
          scene = cleanModelText(extract(vision));
        }

        if (wantsWeb) {
          if (env.TAVILY_API_KEY) {
            try {
              const query = buildSearchQuery(text, scene);
              const data = await tavilySearchRaw(env.TAVILY_API_KEY, query);
              const answer = formatTavilyAnswer(data, scene, text);
              if (answer) {
                return chatReply(answer, {
                  visionUsed: hasImage,
                  webUsed: true,
                  webProvider: "Tavily",
                  model: "Tavily direct"
                }, cors, "I found it online. The links and details are on screen.");
              }
            } catch (e) {
              // fall through to AI answer below
            }
          }

          try {
            const searchPrompt = `${system}\n\n${scene ? `CURRENT CAMERA OBSERVATION:\n${scene}\n\n` : ""}USER REQUEST:\n${text}\n\nGive only the final user-facing answer. If you cannot perform the live lookup, say that the live search failed on this request. Do not show planning or search steps.`;
            const web = await env.AI.run("openai/gpt-5.5", {
              input: searchPrompt,
              max_output_tokens: 450,
              tools: [{ type: "web_search_preview" }],
              reasoning: { effort: "low" }
            }, { gateway: { id: env.AI_GATEWAY_ID || "default" } });
            const webAnswer = cleanModelText(extract(web));
            if (webAnswer) return chatReply(webAnswer, { visionUsed: hasImage, webUsed: true, webProvider: "Cloudflare AI Gateway", model: "openai/gpt-5.5" }, cors);
          } catch (_) {}

          return chatReply("Live search failed on this request. Try the search again in a moment.", { visionUsed: hasImage, webUsed: false, model: "fallback" }, cors, "The live search failed. Try again in a moment.");
        }

        const userContext = `${scene ? `CURRENT LIVE CAMERA OBSERVATION:\n${scene}\n\n` : ""}USER:\n${text}`;
        const result = await env.AI.run("@cf/openai/gpt-oss-120b", {
          messages: [
            { role: "system", content: system + (hasImage ? "\nA current camera observation is included. Treat it as what EARA sees now." : "") },
            { role: "user", content: userContext }
          ],
          max_tokens: 520,
          temperature: 0.4
        });

        let answer = cleanModelText(extract(result));
        if (hasImage && isFalseVisionRefusal(answer)) answer = scene || "I received the live camera frame, but the visual description failed on this request.";
        return chatReply(answer || "I couldn't generate a response.", { visionUsed: hasImage, webUsed: false, model: "@cf/openai/gpt-oss-120b" }, cors);
      }

      return j({ ok: true, service: "EARA Cloudflare AI backend", reasoning: "GPT-OSS 120B", vision: "Llama 3.2 Vision", voice: "Deepgram Aura", web: "Tavily direct" }, 200, cors);
    } catch (e) {
      return j({ error: String(e?.message || e) }, 500, cors);
    }
  }
};

function chatReply(text, meta, cors, speechOverride = "") {
  const full = String(text || "").trim();
  return j({ text: full, speech: speechOverride || makeSpeech(full, !!meta?.webUsed), ...meta }, 200, cors);
}

function formatTavilyAnswer(data, scene, request) {
  const rows = (data?.results || []).filter(x => x?.url).slice(0, 5);
  if (!rows.length) return "";

  const identified = conciseIdentity(scene);
  let out = identified ? `I found matches for ${identified}.\n\n` : "I found these live matches online:\n\n";

  rows.forEach((x, i) => {
    const title = cleanLine(x.title || `Result ${i + 1}`);
    const snippet = cleanLine(x.content || "");
    const price = findPrice(`${title} ${snippet}`);
    out += `${i + 1}. ${title}`;
    if (price) out += `\nPrice shown: ${price}`;
    if (snippet) out += `\n${snippet.slice(0, 220)}`;
    out += `\n${x.url}\n\n`;
  });

  out += "Tap any blue link above to open it.";
  return out.trim();
}

function conciseIdentity(scene) {
  let s = cleanLine(scene || "");
  if (!s) return "";
  s = s.replace(/^(?:the image shows|i see|visible(?: item)?(?: is|:)?|this appears to be)\s*/i, "").trim();
  if (s.length > 110) s = s.slice(0, 110).replace(/\s+\S*$/, "");
  return s;
}

function cleanLine(s) {
  return String(s || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function findPrice(s) {
  const m = String(s || "").match(/(?:US\$|\$)\s?\d{1,5}(?:,\d{3})*(?:\.\d{2})?/i);
  return m ? m[0].replace(/\s+/g, "") : "";
}

function cleanModelText(input) {
  let s = String(input || "").trim();
  if (!s) return "";
  const bad = /^(?:search web|search query|search result|search|open|provide link|we need to|let'?s (?:search|open|verify|produce)|now craft answer|now produce|spoken summary|on-screen details)\b/i;
  const lines = s.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const kept = lines.filter(x => !bad.test(x));
  s = kept.join("\n").trim();
  s = s.replace(/^\*\*Spoken Summary:\*\*\s*/i, "").trim();
  return s;
}

function makeSpeech(input, web = false) {
  const raw = cleanModelText(String(input || "").trim());
  if (!raw) return "";
  const hadLink = /(?:https?:\/\/|www\.)/i.test(raw);
  const price = findPrice(raw);
  let clean = raw
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)]+\)/gi, "$1")
    .replace(/(?:https?:\/\/|www\.)\S+/gi, "")
    .replace(/[\*_`#>|]+/g, " ")
    .replace(/^\s*\d+[.)]\s*/gm, "")
    .replace(/^\s*[-•]\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();

  let first = (clean.match(/[^.!?]+[.!?]+|[^.!?]+$/) || [clean])[0].trim().replace(/[:;,\-\s]+$/, ".");
  if (!first || first.length < 3) first = "I found the information.";
  if (first.length > 135) {
    first = first.slice(0, 135);
    const cut = first.lastIndexOf(" ");
    if (cut > 90) first = first.slice(0, cut);
    first = first.replace(/[,;:\-\s]+$/, ".");
  }
  if ((web || hadLink) && price && !first.includes(price)) first += ` One price I found is ${price}.`;
  if (web || hadLink) first += " The links and full details are on screen.";
  return first.replace(/\s+/g, " ").trim().slice(0, 210);
}

function isWebIntent(s) {
  return /\b(search|search for|look up|lookup|find|locate|show me where|online|internet|web|amazon|ebay|walmart|best buy|buy|purchase|order|price|cost|deal|seller|store|where can i get|where can i buy|where do i get|link|website|latest|current|today|news|weather|stock price|score|near me|open now|available|availability|send me the link|give me the link)\b/i.test(String(s || ""));
}

function buildSearchQuery(text, scene) {
  const t = String(text || "").trim();
  const s = String(scene || "").trim();
  return s ? `${t}\nExact visible item details: ${s}` : t;
}

async function tavilySearchRaw(key, query) {
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      search_depth: "basic",
      max_results: 6,
      include_answer: false,
      include_raw_content: false,
      include_images: false
    })
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Tavily ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function isFalseVisionRefusal(s) {
  return /(?:can(?:not|'t) (?:visually )?(?:see|observe|view|access)|do not have (?:the )?capability to (?:visually )?(?:see|observe)|text-based inputs only|large language model.*(?:see|visual))/i.test(String(s || ""));
}

function bytesToBase64(bytes) {
  let out = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) out += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(out);
}

function extract(d) {
  if (typeof d === "string") return d.trim();
  if (d?.output_text) return String(d.output_text).trim();
  if (d?.response) return String(d.response).trim();
  if (d?.result?.response) return String(d.result.response).trim();
  if (d?.text) return String(d.text).trim();
  if (d?.choices?.[0]?.message?.content) return String(d.choices[0].message.content).trim();
  if (Array.isArray(d?.output)) {
    const parts = [];
    for (const item of d.output) for (const c of item?.content || []) if (c?.text) parts.push(c.text);
    if (parts.length) return parts.join("\n").trim();
  }
  return "";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function j(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
