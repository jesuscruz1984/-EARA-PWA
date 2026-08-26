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

function wantsPdfArtifact(text){
  return /\bpdf\b|\bportable document format\b/i.test(String(text||''));
}

function cleanAscii(input){
  return String(input??'')
    .replace(/[\u2018\u2019]/g,"'")
    .replace(/[\u201C\u201D]/g,'"')
    .replace(/[\u2013\u2014]/g,'-')
    .replace(/\u2022/g,'-')
    .replace(/\u00A0/g,' ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g,'')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g,'?');
}
function pdfEscape(s){return cleanAscii(s).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)')}
function wrapPdfText(text,maxWidth,fontSize,bold=false){
  const avg=(bold?.56:.52)*fontSize,max=Math.max(8,Math.floor(maxWidth/avg)),out=[];
  for(const p of cleanAscii(text).split(/\r?\n/)){
    if(!p.trim()){out.push('');continue}
    const words=p.trim().split(/\s+/);let line='';
    for(const original of words){
      let w=original;
      while(w.length>max){if(line){out.push(line);line=''}out.push(w.slice(0,max));w=w.slice(max)}
      const cand=line?line+' '+w:w;
      if(cand.length>max){if(line)out.push(line);line=w}else line=cand;
    }
    if(line)out.push(line);
  }
  return out;
}
function bytesBase64(bytes){
  let out='';const step=0x8000;
  for(let i=0;i<bytes.length;i+=step)out+=String.fromCharCode(...bytes.subarray(i,Math.min(bytes.length,i+step)));
  return btoa(out);
}
function safeFileName(input){
  const s=cleanAscii(input||'Agent-Document').replace(/[^A-Za-z0-9._ -]+/g,'').trim().replace(/\s+/g,'-').slice(0,80);
  return (s||'Agent-Document').replace(/\.pdf$/i,'')+'.pdf';
}
function extractJsonObject(text){
  let s=String(text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/```$/,'').trim();
  const a=s.indexOf('{'),b=s.lastIndexOf('}');if(a<0||b<=a)throw new Error('Document planner returned invalid JSON.');
  return JSON.parse(s.slice(a,b+1));
}
function normalizePdfSpec(raw,requestText,localDate){
  const obj=raw&&typeof raw==='object'?raw:{};
  const arr=x=>Array.isArray(x)?x.map(v=>cleanAscii(v)).filter(Boolean):[];
  const sections=Array.isArray(obj.sections)?obj.sections.slice(0,10).map(s=>({
    heading:cleanAscii(s?.heading||'Project Details').slice(0,90),
    paragraphs:arr(s?.paragraphs).slice(0,5),
    bullets:arr(s?.bullets).slice(0,12)
  })):[];
  const equipment=Array.isArray(obj.equipment)?obj.equipment.slice(0,30).map(r=>({
    item:cleanAscii(r?.item||'').slice(0,130),qty:cleanAscii(r?.qty??'').slice(0,24),description:cleanAscii(r?.description||'').slice(0,300)
  })).filter(r=>r.item||r.description):[];
  return {
    title:cleanAscii(obj.title||'Professional Proposal').slice(0,130),
    subtitle:cleanAscii(obj.subtitle||'').slice(0,180),
    client:cleanAscii(obj.client||obj.preparedFor||'').slice(0,120),
    preparedBy:cleanAscii(obj.preparedBy||'').slice(0,120),
    date:cleanAscii(obj.date||localDate||'').slice(0,80),
    reference:cleanAscii(obj.reference||'').slice(0,80),
    objective:cleanAscii(obj.objective||'').slice(0,650),
    executiveSummary:cleanAscii(obj.executiveSummary||'').slice(0,2400),
    scope:arr(obj.scope).slice(0,16),equipment,sections,
    assumptions:arr(obj.assumptions).slice(0,16),
    commercialNotes:arr(obj.commercialNotes).slice(0,14),
    nextSteps:arr(obj.nextSteps).slice(0,12),
    sourceRequest:cleanAscii(requestText).slice(0,500)
  };
}
function buildProfessionalPdf(spec){
  const W=612,H=792,M=50,navy=[.05,.16,.30],blue=[.08,.38,.65],light=[.94,.96,.98],gray=[.36,.39,.43],dark=[.10,.12,.15];
  const pages=[];let cmds=[],y=H-M;
  const rgb=a=>`${a[0].toFixed(3)} ${a[1].toFixed(3)} ${a[2].toFixed(3)}`;
  const text=(s,x,yy,size=10,bold=false,color=dark)=>cmds.push(`BT /${bold?'F2':'F1'} ${size} Tf ${rgb(color)} rg 1 0 0 1 ${x.toFixed(2)} ${yy.toFixed(2)} Tm (${pdfEscape(s)}) Tj ET`);
  const rect=(x,yy,w,h,color)=>cmds.push(`${rgb(color)} rg ${x} ${yy} ${w} ${h} re f`);
  const line=(x1,y1,x2,y2,color=gray,width=1)=>cmds.push(`${rgb(color)} RG ${width} w ${x1} ${y1} m ${x2} ${y2} l S`);
  const pageHeader=()=>{
    const label=spec.preparedBy?cleanAscii(spec.preparedBy).toUpperCase():'PROFESSIONAL PROPOSAL';
    rect(0,H-44,W,44,navy);text(label.slice(0,62),M,H-27,9,true,[1,1,1]);
    line(M,36,W-M,36,[.75,.78,.82],.5);text('Confidential',M,22,8,false,gray);text(String(pages.length+1),W-M-8,22,8,false,gray);y=H-76;
  };
  const addPage=(content=false)=>{if(cmds.length)pages.push(cmds.join('\n'));cmds=[];y=H-M;if(content)pageHeader()};
  const ensure=need=>{if(y-need<58)addPage(true)};
  const paragraph=(s,{size=10,leading=14,bold=false,color=dark,indent=0,spaceAfter=8}={})=>{const lines=wrapPdfText(s,W-2*M-indent,size,bold);ensure(lines.length*leading+spaceAfter);for(const ln of lines){if(ln)text(ln,M+indent,y,size,bold,color);y-=leading}y-=spaceAfter};
  const heading=s=>{ensure(34);text(cleanAscii(s).toUpperCase(),M,y,12,true,blue);y-=9;line(M,y,W-M,y,[.80,.85,.90],.8);y-=18};
  const bullets=arr=>{for(const b of arr||[]){const lines=wrapPdfText(b,W-2*M-20,10,false);ensure(lines.length*14+5);text('-',M+2,y,10,true,blue);for(const ln of lines){text(ln,M+18,y,10,false,dark);y-=14}y-=4}};
  const table=rows=>{
    if(!rows?.length)return;const cols=[235,48,229],x0=M,headH=26;
    const drawHeader=()=>{rect(x0,y-headH,W-2*M,headH,navy);text('Equipment / Service',x0+8,y-17,9,true,[1,1,1]);text('Qty',x0+cols[0]+8,y-17,9,true,[1,1,1]);text('Description',x0+cols[0]+cols[1]+8,y-17,9,true,[1,1,1]);y-=headH};
    ensure(headH+36);drawHeader();
    for(const r of rows){const a=wrapPdfText(r.item||'',cols[0]-14,9.3),b=wrapPdfText(String(r.qty??''),cols[1]-14,9.3,true),c=wrapPdfText(r.description||'',cols[2]-14,9.3),n=Math.max(a.length,b.length,c.length,1),rh=Math.max(24,n*12+10);if(y-rh<58){addPage(true);drawHeader()}rect(x0,y-rh,W-2*M,rh,light);line(x0,y-rh,x0+W-2*M,y-rh,[.78,.82,.86],.5);line(x0+cols[0],y-rh,x0+cols[0],y,[.78,.82,.86],.5);line(x0+cols[0]+cols[1],y-rh,x0+cols[0]+cols[1],y,[.78,.82,.86],.5);for(let i=0;i<n;i++){const yy=y-16-i*12;if(a[i])text(a[i],x0+7,yy,9.3,false,dark);if(b[i])text(b[i],x0+cols[0]+8,yy,9.3,true,dark);if(c[i])text(c[i],x0+cols[0]+cols[1]+7,yy,9.3,false,dark)}y-=rh}y-=12;
  };

  rect(0,0,W,H,[1,1,1]);rect(0,H-205,W,205,navy);rect(M,H-225,80,4,blue);text('PROPOSAL',M,H-78,11,true,[.63,.82,1]);
  let titleLines=wrapPdfText(spec.title||'Professional Proposal',W-2*M,25,true),ty=H-115;for(const ln of titleLines.slice(0,3)){text(ln,M,ty,25,true,[1,1,1]);ty-=31}
  if(spec.subtitle){for(const ln of wrapPdfText(spec.subtitle,W-2*M,13).slice(0,3)){text(ln,M,ty-4,13,false,[.85,.90,.96]);ty-=18}}
  y=H-286;const info=[];if(spec.client)info.push(['Prepared for',spec.client]);if(spec.preparedBy)info.push(['Prepared by',spec.preparedBy]);if(spec.date)info.push(['Date',spec.date]);if(spec.reference)info.push(['Reference',spec.reference]);
  for(const [k,v] of info){text(k.toUpperCase(),M,y,8.5,true,blue);for(const ln of wrapPdfText(v,W-2*M,12).slice(0,3)){text(ln,M,y-20,12,false,dark);y-=16}y-=24}
  rect(M,88,W-2*M,76,light);text('PROJECT OBJECTIVE',M+16,142,9,true,blue);const obj=spec.objective||spec.executiveSummary||'Deliver a professional solution aligned to the client requirements.';let oy=122;for(const ln of wrapPdfText(obj,W-2*M-32,10).slice(0,5)){text(ln,M+16,oy,10,false,dark);oy-=13}
  text('Prepared as a client-ready professional project document.',M,52,8.5,false,gray);

  addPage(true);
  if(spec.executiveSummary){heading('Executive Summary');paragraph(spec.executiveSummary,{size:10.5,leading:15,spaceAfter:12})}
  if(spec.scope?.length){heading('Scope of Work');bullets(spec.scope);y-=8}
  if(spec.equipment?.length){heading('Proposed Equipment');table(spec.equipment)}
  for(const s of spec.sections||[]){heading(s.heading||'Project Details');for(const p of s.paragraphs||[])paragraph(p);bullets(s.bullets||[]);y-=6}
  if(spec.assumptions?.length){heading('Assumptions & Exclusions');bullets(spec.assumptions);y-=6}
  if(spec.commercialNotes?.length){heading('Commercial Notes');bullets(spec.commercialNotes);y-=6}
  if(spec.nextSteps?.length){heading('Next Steps');bullets(spec.nextSteps);y-=6}
  if(cmds.length)pages.push(cmds.join('\n'));

  const n=pages.length,objs=[];objs[1]='<< /Type /Catalog /Pages 2 0 R >>';const kids=[];for(let i=0;i<n;i++)kids.push(`${5+i*2} 0 R`);objs[2]=`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${n} >>`;objs[3]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';objs[4]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  for(let i=0;i<n;i++){const pageObj=5+i*2,contentObj=pageObj+1,stream=pages[i];objs[pageObj]=`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObj} 0 R >>`;objs[contentObj]=`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`}
  let pdf='%PDF-1.4\n%AGENT10\n';const offsets=[0],maxObj=4+n*2;for(let i=1;i<=maxObj;i++){offsets[i]=pdf.length;pdf+=`${i} 0 obj\n${objs[i]}\nendobj\n`}const xref=pdf.length;pdf+=`xref\n0 ${maxObj+1}\n0000000000 65535 f \n`;for(let i=1;i<=maxObj;i++)pdf+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';pdf+=`trailer\n<< /Size ${maxObj+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

async function handlePdfArtifact(body,env,headers){
  const requestText=String(body?.text||'').trim(),localDate=String(body?.localDate||'').trim();
  const context=String(body?.memory||'').slice(-16000);
  const instructions=`You are Agent 1.0 creating a polished client-ready business PDF. Return ONE JSON object only, with no markdown and no commentary. Do not use placeholders such as [Insert Date], [Your Company], [Name], or TBD. If a field is unknown, omit it or write a professional neutral note in assumptions instead. Do not invent pricing, exact model numbers, warranties, retention periods, company identity, or contact information unless supplied by the user or recent conversation. For surveillance/security proposals, make the scope technically credible and professional, but keep unspecified equipment descriptive rather than fabricating model numbers. Write concise, polished business language. Schema: {"title":"...","subtitle":"...","client":"...","preparedBy":"...","date":"...","reference":"...","objective":"...","executiveSummary":"...","scope":["..."],"equipment":[{"item":"...","qty":"...","description":"..."}],"sections":[{"heading":"...","paragraphs":["..."],"bullets":["..."]}],"assumptions":["..."],"commercialNotes":["..."],"nextSteps":["..."]}. Use only fields that improve the final document.`;
  const input=[{role:'user',content:[{type:'input_text',text:`${context?`RECENT CONVERSATION:\n${context}\n\n`:''}USER REQUEST:\n${requestText}\n\nUSER LOCAL DATE:\n${localDate||'Not provided'}`}]}];
  const ai=gatewayAI(env);let result=null,model='',last=null;
  for(const candidate of [SOL,TERRA]){
    try{result=await ai.run(candidate,{input,instructions,max_output_tokens:2300,reasoning:{effort:candidate===SOL?'medium':'low'},store:false});const t=responseText(result);if(t){model=candidate;break}}catch(e){last=e;result=null}
  }
  if(!result)throw last||new Error('Could not create PDF content.');
  let spec;try{spec=normalizePdfSpec(extractJsonObject(responseText(result)),requestText,localDate)}catch(e){
    const retry=await ai.run(TERRA,{input,instructions:instructions+'\nIMPORTANT: Your previous response was not valid JSON. Return valid JSON only.',max_output_tokens:2000,reasoning:{effort:'low'},store:false});model=TERRA;spec=normalizePdfSpec(extractJsonObject(responseText(retry)),requestText,localDate);
  }
  const bytes=buildProfessionalPdf(spec),filename=safeFileName(`${spec.client?spec.client+'-':''}${spec.title||'Proposal'}`);
  return json({
    text:`Done - I created the professional PDF${spec.client?` for ${spec.client}`:''}. Open or save the file below.`,
    speech:'Done. I created the professional PDF and attached it below.',
    model,route:model===SOL?'sol':'terra',toolsUsed:['pdf'],pdfCreated:true,
    files:[{name:filename,mime:'application/pdf',data:bytesBase64(bytes),size:bytes.length}]
  },200,headers);
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

function responseTools(result,planned=[]){
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
  return used.size?[...used]:planned.filter(x=>x==='web'&&wantsWebTool('',false));
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

  if(wantsPdfArtifact(text))return handlePdfArtifact(body,env,headers);

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
  const toolsUsed=responseTools(result,plan.labels);
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
        agentTools:['web search','code interpreter','image generation','professional PDF creation','vision','direct file input','voice'],
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
          {id:'pdf',name:'Professional PDF creation + downloadable file'},
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
