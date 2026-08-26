import core from './secure-worker.js';

const OSS='@cf/openai/gpt-oss-120b';
const GEMMA='@cf/google/gemma-4-26b-a4b-it';

function cors(origin,env){
  const allowed=env.ALLOWED_ORIGIN||'https://jesuscruz1984.github.io';
  const h={
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer',
    'Vary':'Origin'
  };
  if(origin===allowed)h['Access-Control-Allow-Origin']=allowed;
  return h;
}
function j(data,status,headers){return new Response(JSON.stringify(data),{status,headers})}
function clean(s){return String(s??'').replace(/[\u2018\u2019]/g,"'").replace(/[\u201C\u201D]/g,'"').replace(/[\u2013\u2014]/g,'-').replace(/\u2022/g,'-').replace(/\u00A0/g,' ').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x09\x0A\x0D\x20-\x7E]/g,'?')}
function esc(s){return clean(s).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)')}
function b64(bytes){let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,Math.min(i+0x8000,bytes.length)));return btoa(s)}
function safeName(s){return (clean(s||'Agent-Document').replace(/[^A-Za-z0-9._ -]+/g,'').trim().replace(/\s+/g,'-').slice(0,80)||'Agent-Document').replace(/\.pdf$/i,'')+'.pdf'}
function textOf(r){
  if(typeof r==='string')return r.trim();
  if(r?.response)return String(r.response).trim();
  if(r?.output_text)return String(r.output_text).trim();
  const p=[];
  for(const x of Array.isArray(r?.output)?r.output:[]){
    if(x?.text)p.push(String(x.text));
    for(const c of Array.isArray(x?.content)?x.content:[])if(c?.text)p.push(String(c.text));
  }
  return p.join('\n').trim();
}
function jsonObj(s){
  let t=String(s||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/```$/,'').trim();
  const a=t.indexOf('{'),b=t.lastIndexOf('}');if(a<0||b<=a)throw new Error('no json');return JSON.parse(t.slice(a,b+1));
}
function arr(x){return Array.isArray(x)?x.map(clean).filter(Boolean):[]}
function deterministicSpec(requestText,date){
  const t=clean(requestText);
  const client=(t.match(/client (?:called|named)\s+([a-z0-9 &.-]+)/i)||[])[1]?.replace(/\s+(?:with|using|for)\b[\s\S]*$/i,'').trim()||'';
  const qty=(t.match(/\b(\d{1,4})\s*(?:camera|cameras|cam)\b/i)||[])[1]||'';
  const brand=(t.match(/\b(uniview|hikvision|hanwha|axis|ubiquiti)\b/i)||[])[1]||'';
  const brandName=brand?brand[0].toUpperCase()+brand.slice(1).toLowerCase():'IP surveillance';
  return {
    title:`${brandName} Video Surveillance Proposal`,
    subtitle:qty?`${qty}-Camera Deployment`:'Professional Security Camera Deployment',
    client:client||'',date:date||'',
    objective:`Provide a reliable, scalable video surveillance solution with professional installation, centralized recording, remote management, and clear system documentation.`,
    executiveSummary:`This proposal outlines a turnkey ${brandName} video surveillance solution designed to improve coverage, recording reliability, remote visibility, and future scalability. The final camera models, lenses, storage capacity, retention targets, mounting conditions, and network requirements will be confirmed during final design and site verification.`,
    scope:[
      `Provide and install ${qty?qty+' ':''}professional IP surveillance cameras at approved locations.`,
      `Provide appropriately sized network video recorder capacity and compatible storage based on final retention requirements.`,
      `Configure recording, time synchronization, user access, remote viewing, and basic event settings.`,
      `Test camera views, focus, night performance, recording, playback, and remote access.`,
      `Label installed equipment and provide basic turnover documentation.`
    ],
    equipment:[
      {item:`${brandName} IP Cameras`,qty:qty||'As required',description:'Professional network cameras selected to match each field of view and lighting condition.'},
      {item:`${brandName} Network Video Recorder`,qty:'As required',description:'NVR capacity sized for final camera count, resolution, bitrate, storage, and retention requirements.'},
      {item:'Surveillance Storage',qty:'As required',description:'Purpose-built storage sized after final retention and recording settings are approved.'},
      {item:'PoE / Network Components',qty:'As required',description:'Compatible switching, PoE, patching, and network components where required by the final design.'}
    ],
    assumptions:[
      'Exact model numbers, pricing, storage retention, cable distances, and mounting requirements are subject to final site verification and approved design.',
      'Existing network, electrical power, pathways, lifts, permits, patching/painting, and after-hours requirements are excluded unless specifically included in the final commercial proposal.',
      'No unprovided pricing or manufacturer model numbers have been invented in this document.'
    ],
    nextSteps:['Confirm final camera locations and fields of view.','Confirm recording retention target and storage sizing.','Finalize equipment schedule, labor scope, project schedule, and commercial pricing.']
  };
}
function normalize(o,req,date){
  const d=deterministicSpec(req,date),x=o&&typeof o==='object'?o:{};
  const eq=Array.isArray(x.equipment)?x.equipment.map(r=>({item:clean(r?.item||''),qty:clean(r?.qty||''),description:clean(r?.description||'')})).filter(r=>r.item||r.description):d.equipment;
  return {
    title:clean(x.title||d.title).slice(0,120),subtitle:clean(x.subtitle||d.subtitle).slice(0,150),client:clean(x.client||d.client).slice(0,100),date:clean(x.date||d.date).slice(0,60),
    objective:clean(x.objective||d.objective).slice(0,700),executiveSummary:clean(x.executiveSummary||d.executiveSummary).slice(0,2500),
    scope:arr(x.scope).length?arr(x.scope).slice(0,14):d.scope,equipment:eq.slice(0,24),assumptions:arr(x.assumptions).length?arr(x.assumptions).slice(0,14):d.assumptions,nextSteps:arr(x.nextSteps).length?arr(x.nextSteps).slice(0,10):d.nextSteps
  };
}
function wrap(text,max){
  const out=[];for(const p of clean(text).split(/\r?\n/)){if(!p.trim()){out.push('');continue}let line='';for(const w0 of p.trim().split(/\s+/)){let w=w0;while(w.length>max){if(line){out.push(line);line=''}out.push(w.slice(0,max));w=w.slice(max)}const c=line?line+' '+w:w;if(c.length>max){if(line)out.push(line);line=w}else line=c}if(line)out.push(line)}return out;
}
function buildPdf(s){
  const W=612,H=792,M=50;const pages=[];let c=[],y=H-64;
  const t=(txt,x,yy,size=10,b=false)=>c.push(`BT /${b?'F2':'F1'} ${size} Tf 0.10 0.12 0.15 rg 1 0 0 1 ${x} ${yy} Tm (${esc(txt)}) Tj ET`);
  const line=(x1,y1,x2,y2)=>c.push(`0.82 0.85 0.88 RG 0.7 w ${x1} ${y1} m ${x2} ${y2} l S`);
  const rect=(x,yy,w,h,r,g,b)=>c.push(`${r} ${g} ${b} rg ${x} ${yy} ${w} ${h} re f`);
  const push=()=>{pages.push(c.join('\n'));c=[];y=H-64};
  const header=()=>{rect(0,H-46,W,46,.05,.16,.30);c.push(`BT /F2 9 Tf 1 1 1 rg 1 0 0 1 ${M} ${H-29} Tm (AGENT 1.0 - PROFESSIONAL PROPOSAL) Tj ET`);y=H-78};
  const ensure=n=>{if(y-n<55){push();header()}};
  const heading=h=>{ensure(38);t(clean(h).toUpperCase(),M,y,12,true);y-=10;line(M,y,W-M,y);y-=20};
  const para=(p,size=10)=>{for(const l of wrap(p,96)){ensure(15);if(l)t(l,M,y,size,false);y-=14}y-=7};
  const bullets=a=>{for(const b of a||[]){const ls=wrap(b,90);ensure(ls.length*14+8);t('-',M+2,y,10,true);for(const l of ls){t(l,M+18,y,10,false);y-=14}y-=4}};
  rect(0,0,W,H,1,1,1);rect(0,H-210,W,210,.05,.16,.30);c.push(`BT /F2 11 Tf 0.63 0.82 1 rg 1 0 0 1 ${M} ${H-76} Tm (PROPOSAL) Tj ET`);
  let ty=H-118;for(const l of wrap(s.title,42).slice(0,3)){c.push(`BT /F2 24 Tf 1 1 1 rg 1 0 0 1 ${M} ${ty} Tm (${esc(l)}) Tj ET`);ty-=30}
  if(s.subtitle){for(const l of wrap(s.subtitle,62).slice(0,2)){c.push(`BT /F1 13 Tf 0.86 0.91 0.97 rg 1 0 0 1 ${M} ${ty} Tm (${esc(l)}) Tj ET`);ty-=18}}
  y=H-290;if(s.client){t('PREPARED FOR',M,y,8,true);y-=20;t(s.client,M,y,13,false);y-=36}if(s.date){t('DATE',M,y,8,true);y-=20;t(s.date,M,y,11,false);y-=34}
  rect(M,86,W-2*M,78,.94,.96,.98);t('PROJECT OBJECTIVE',M+15,143,9,true);let oy=122;for(const l of wrap(s.objective,86).slice(0,5)){t(l,M+15,oy,9.5,false);oy-=13}
  push();header();heading('Executive Summary');para(s.executiveSummary,10.5);heading('Scope of Work');bullets(s.scope);
  if(s.equipment?.length){heading('Proposed Equipment');for(const r of s.equipment){ensure(58);t(`${r.item}${r.qty?' - Qty: '+r.qty:''}`,M,y,10,true);y-=15;for(const l of wrap(r.description,90)){t(l,M+12,y,9.5,false);y-=13}y-=8}}
  heading('Assumptions & Exclusions');bullets(s.assumptions);heading('Next Steps');bullets(s.nextSteps);if(c.length)push();
  const n=pages.length,objs=[];objs[1]='<< /Type /Catalog /Pages 2 0 R >>';objs[2]=`<< /Type /Pages /Kids [${pages.map((_,i)=>`${5+i*2} 0 R`).join(' ')}] /Count ${n} >>`;objs[3]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';objs[4]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  pages.forEach((stream,i)=>{const p=5+i*2,q=p+1;objs[p]=`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${q} 0 R >>`;objs[q]=`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`});
  let pdf='%PDF-1.4\n%AGENT10\n',offs=[0],max=4+n*2;for(let i=1;i<=max;i++){offs[i]=pdf.length;pdf+=`${i} 0 obj\n${objs[i]}\nendobj\n`}const xr=pdf.length;pdf+=`xref\n0 ${max+1}\n0000000000 65535 f \n`;for(let i=1;i<=max;i++)pdf+=String(offs[i]).padStart(10,'0')+' 00000 n \n';pdf+=`trailer\n<< /Size ${max+1} /Root 1 0 R >>\nstartxref\n${xr}\n%%EOF\n`;return new TextEncoder().encode(pdf);
}
async function fallbackPdf(body,env,origin){
  const requestText=String(body?.text||'').trim(),date=String(body?.localDate||'').trim();let spec=null,model='deterministic-pdf-fallback';
  const prompt=`Return valid JSON only. Create a polished client-ready business proposal from this request. Never invent exact model numbers, prices, warranties, retention periods, or company contact details that were not supplied. Schema: {"title":"","subtitle":"","client":"","date":"","objective":"","executiveSummary":"","scope":[""],"equipment":[{"item":"","qty":"","description":""}],"assumptions":[""],"nextSteps":[""]}. Request: ${requestText}`;
  for(const m of [OSS,GEMMA]){
    try{
      const r=await env.AI.run(m,{messages:[{role:'user',content:prompt}],max_tokens:1600,temperature:0.2});
      const raw=textOf(r);if(raw){spec=normalize(jsonObj(raw),requestText,date);model=m;break}
    }catch(_){ }
  }
  if(!spec)spec=normalize(null,requestText,date);
  const bytes=buildPdf(spec),name=safeName(`${spec.client?spec.client+'-':''}${spec.title}`),headers=cors(origin,env);
  return j({text:`Done - I created the professional PDF${spec.client?` for ${spec.client}`:''}. Open or save the file below.`,speech:'Done. I created the professional PDF and attached it below.',model,route:'pdf-fallback',toolsUsed:['pdf'],pdfCreated:true,files:[{name,mime:'application/pdf',data:b64(bytes),size:bytes.length}]},200,headers);
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==='/agent-chat'&&request.method==='POST'){
      const clone=request.clone();let body=null;
      try{body=await clone.json()}catch(_){body=null}
      const wantsPdf=/\bpdf\b|portable document format/i.test(String(body?.text||''));
      if(wantsPdf){
        try{
          const primary=await core.fetch(request.clone(),env,ctx);
          if(primary.status<500)return primary;
        }catch(_){ }
        return fallbackPdf(body,env,request.headers.get('Origin')||'');
      }
    }
    return core.fetch(request,env,ctx);
  }
};
