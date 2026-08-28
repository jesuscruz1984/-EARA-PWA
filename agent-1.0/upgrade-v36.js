/* Agent 1.0 v36 interaction + document artifact upgrade.
   Works in the browser and adds native Android save behavior when EARANative exists. */
(function(root){
  'use strict';

  const VERSION='36';
  const enc=new TextEncoder();

  function ascii(s){
    return String(s??'')
      .replace(/[\u2018\u2019]/g,"'").replace(/[\u201C\u201D]/g,'"')
      .replace(/[\u2013\u2014]/g,'-').replace(/\u2022/g,'-').replace(/\u00a0/g,' ')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x09\x0a\x0d\x20-\x7e]/g,'?');
  }
  function xml(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')}
  function pdfEsc(s){return ascii(s).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)')}
  function safeName(s){
    const v=ascii(s).replace(/^\s*#+\s*/,'').replace(/\*+/g,'').replace(/[^A-Za-z0-9._ -]+/g,' ').replace(/\s+/g,' ').trim();
    return (v||'Agent Document').slice(0,72);
  }
  function detectFormats(text){
    const t=String(text||'');const out=[];
    if(/\bpdf\b|portable document format/i.test(t))out.push('pdf');
    if(/\bdocx\b|\bword\s+(?:file|document)\b|microsoft\s+word/i.test(t))out.push('docx');
    return [...new Set(out)];
  }
  function inferTitle(content,prompt){
    const lines=String(content||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    const first=(lines[0]||'').replace(/^#{1,6}\s*/,'').replace(/^\*\*(.*?)\*\*$/,'$1').trim();
    if(first&&first.length<=80&&!/[.!?]$/.test(first))return safeName(first);
    const p=String(prompt||'').replace(/\b(create|make|generate|export|save|turn|convert|me|a|an|the|pdf|docx|word|file|document|into|as)\b/gi,' ').replace(/\s+/g,' ').trim();
    return safeName(p||'Agent Document');
  }
  function wrap(text,max){
    const out=[];
    for(const raw of ascii(text).split(/\r?\n/)){
      const p=raw.trim();
      if(!p){out.push('');continue}
      let line='';
      for(const word of p.split(/\s+/)){
        const next=line?line+' '+word:word;
        if(next.length>max&&line){out.push(line);line=word}else line=next;
      }
      if(line)out.push(line);
    }
    return out;
  }
  function bytesToB64(bytes){
    if(typeof btoa==='function'){
      let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,Math.min(bytes.length,i+0x8000)));
      return btoa(s);
    }
    if(typeof Buffer!=='undefined')return Buffer.from(bytes).toString('base64');
    throw new Error('Base64 unavailable');
  }
  function concat(parts){let n=0;for(const p of parts)n+=p.length;const out=new Uint8Array(n);let o=0;for(const p of parts){out.set(p,o);o+=p.length}return out}
  function u16(n){return new Uint8Array([n&255,(n>>>8)&255])}
  function u32(n){return new Uint8Array([n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255])}
  function crc32(bytes){
    let c=0xffffffff;
    for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}
    return (c^0xffffffff)>>>0;
  }
  function zipStore(entries){
    const local=[],central=[];let offset=0;
    for(const entry of entries){
      const name=enc.encode(entry.name),data=entry.data instanceof Uint8Array?entry.data:enc.encode(String(entry.data)),crc=crc32(data);
      const lh=concat([u32(0x04034b50),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),name,data]);
      local.push(lh);
      const ch=concat([u32(0x02014b50),u16(20),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name]);
      central.push(ch);offset+=lh.length;
    }
    const cdir=concat(central),body=concat(local);
    const end=concat([u32(0x06054b50),u16(0),u16(0),u16(entries.length),u16(entries.length),u32(cdir.length),u32(body.length),u16(0)]);
    return concat([body,cdir,end]);
  }
  function makePdf(title,content){
    const W=612,H=792,M=48;const pages=[];let stream=[],y=H-62;
    const text=(s,x,yy,size=10,bold=false)=>stream.push(`BT /${bold?'F2':'F1'} ${size} Tf 0.10 0.10 0.12 rg 1 0 0 1 ${x} ${yy} Tm (${pdfEsc(s)}) Tj ET`);
    const push=()=>{pages.push(stream.join('\n'));stream=[];y=H-62;text(title,M,H-42,10,true);stream.push(`0.82 0.82 0.84 RG 0.6 w ${M} ${H-50} m ${W-M} ${H-50} l S`)};
    text(title,M,H-52,18,true);y=H-84;
    for(const line of wrap(content,88)){
      if(y<56)push();
      if(!line){y-=8;continue}
      const heading=/^#{1,6}\s+/.test(line)||(/^.{1,70}:$/.test(line)&&line.length<72);
      const clean=line.replace(/^#{1,6}\s+/,'').replace(/^\*\*(.*?)\*\*$/,'$1');
      text(clean,M,y,heading?11:10,heading);y-=heading?18:14;
    }
    if(stream.length)pages.push(stream.join('\n'));
    const objs=[];objs[1]='<< /Type /Catalog /Pages 2 0 R >>';
    objs[2]=`<< /Type /Pages /Kids [${pages.map((_,i)=>`${5+i*2} 0 R`).join(' ')}] /Count ${pages.length} >>`;
    objs[3]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objs[4]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    pages.forEach((st,i)=>{const a=5+i*2,b=a+1;objs[a]=`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${b} 0 R >>`;objs[b]=`<< /Length ${st.length} >>\nstream\n${st}\nendstream`});
    let pdf='%PDF-1.4\n%Agent10-v36\n',offs=[0],max=4+pages.length*2;
    for(let i=1;i<=max;i++){offs[i]=pdf.length;pdf+=`${i} 0 obj\n${objs[i]}\nendobj\n`}
    const xr=pdf.length;pdf+=`xref\n0 ${max+1}\n0000000000 65535 f \n`;for(let i=1;i<=max;i++)pdf+=String(offs[i]).padStart(10,'0')+' 00000 n \n';
    pdf+=`trailer\n<< /Size ${max+1} /Root 1 0 R >>\nstartxref\n${xr}\n%%EOF\n`;
    return enc.encode(pdf);
  }
  function docParagraphs(title,content){
    const ps=[`<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>${xml(title)}</w:t></w:r></w:p>`];
    for(const raw of String(content||'').split(/\r?\n/)){
      let s=raw.trim();if(!s){ps.push('<w:p/>');continue}
      const h=s.match(/^#{1,6}\s+(.+)/);const bullet=s.match(/^[-•]\s+(.+)/);
      if(h)s=h[1];if(bullet)s=bullet[1];
      s=s.replace(/^\*\*(.*?)\*\*$/,'$1');
      const pPr=h?'<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>':(bullet?'<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>':'');
      ps.push(`<w:p>${pPr}<w:r><w:t xml:space="preserve">${xml(s)}</w:t></w:r></w:p>`);
    }
    return ps.join('');
  }
  function makeDocx(title,content){
    const document=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${docParagraphs(title,content)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
    const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style></w:styles>`;
    const numbering=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
    const entries=[
      {name:'[Content_Types].xml',data:`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`},
      {name:'_rels/.rels',data:`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`},
      {name:'word/document.xml',data:document},
      {name:'word/styles.xml',data:styles},
      {name:'word/numbering.xml',data:numbering},
      {name:'word/_rels/document.xml.rels',data:`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`}
    ];
    return zipStore(entries);
  }
  function buildFiles(draft,prompt){
    const d=draft||{},content=String(d.content||d.text||'').trim();if(!content)return [];
    const formats=(Array.isArray(d.formats)&&d.formats.length?d.formats:detectFormats(prompt||'')).map(x=>String(x).toLowerCase());
    const title=safeName(d.title||inferTitle(content,prompt));const files=[];
    if(formats.includes('pdf')){const bytes=makePdf(title,content);files.push({name:title.replace(/\s+/g,'-')+'.pdf',mime:'application/pdf',data:bytesToB64(bytes),size:bytes.length})}
    if(formats.includes('docx')){const bytes=makeDocx(title,content);files.push({name:title.replace(/\s+/g,'-')+'.docx',mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',data:bytesToB64(bytes),size:bytes.length})}
    return files;
  }

  const API={version:VERSION,detectFormats,makePdf,makeDocx,buildFiles,crc32,zipStore};
  root.AgentArtifacts=API;
  if(typeof document==='undefined')return;

  function q(s){return document.querySelector(s)}
  function hasNative(){return !!(root.EARANative&&typeof root.EARANative.getWearableCameraStatus==='function')}
  function installAddFix(){
    const b=q('#addBtn');if(!b||b.dataset.v36Fixed)return;b.dataset.v36Fixed='1';
    b.onclick=e=>{e.stopPropagation();if(typeof root.toggleAttachments==='function')root.toggleAttachments()};
  }
  function installPhoneCamera(){
    if(!hasNative())return;const ep6=q('#cameraBtn'),box=q('#attachments');if(!ep6||!box)return;
    const ep6Label=ep6.querySelector('small');if(ep6Label)ep6Label.textContent='EP6 camera';ep6.title='ORDRO EP6 Plus';
    if(q('#phoneCameraBtn'))return;
    const b=ep6.cloneNode(true);b.id='phoneCameraBtn';b.title='Phone camera';const label=b.querySelector('small');if(label)label.textContent='Phone camera';
    b.onclick=e=>{e.stopPropagation();if(typeof root.hideAttachments==='function')root.hideAttachments();if(typeof root.AgentPhoneCamera==='function')root.AgentPhoneCamera();else if(typeof root.openPhoneCamera==='function')root.openPhoneCamera()};
    box.insertBefore(b,ep6);
  }
  function installArtifactPipeline(){
    if(root.__agentV36FetchWrapped||typeof root.fetchChat!=='function')return;root.__agentV36FetchWrapped=true;
    const base=root.fetchChat;
    root.fetchChat=async function(text,image,file){
      const j=await base(text,image,file);if(!j||typeof j!=='object')return j;
      let files=Array.isArray(j.files)?j.files.slice():[];const draft=j.documentDraft;
      if(draft){
        const made=buildFiles(draft,text);if(made.length){files.push(...made);j.files=files;j.pdfCreated=made.some(f=>/\.pdf$/i.test(f.name));j.wordCreated=made.some(f=>/\.docx$/i.test(f.name));j.text=draft.responseText||`Done — I created ${made.map(f=>f.name).join(' and ')}.`;j.toolsUsed=[...new Set([...(j.toolsUsed||[]),...(j.pdfCreated?['pdf']:[]),...(j.wordCreated?['word']:[])])];}
      }else if(!files.length){
        const formats=detectFormats(text);if(formats.length&&/\b(create|make|generate|export|save|turn|convert)\b/i.test(String(text||''))&&String(j.text||'').trim()){
          const made=buildFiles({content:j.text,formats},text);if(made.length){j.files=made;j.pdfCreated=made.some(f=>/\.pdf$/i.test(f.name));j.wordCreated=made.some(f=>/\.docx$/i.test(f.name));j.toolsUsed=[...new Set([...(j.toolsUsed||[]),...(j.pdfCreated?['pdf']:[]),...(j.wordCreated?['word']:[])])];}
        }
      }
      return j;
    };
  }
  function improveFileLinks(){
    for(const a of document.querySelectorAll('a[download]')){
      if(a.dataset.v36Link)return;a.dataset.v36Link='1';const name=a.getAttribute('download')||'';
      if(/\.docx$/i.test(name))a.textContent='Save Word';else if(/\.pdf$/i.test(name))a.textContent='Save PDF';else a.textContent='Save file';
      if(root.EARANative&&typeof root.EARANative.saveBase64File==='function'){
        a.addEventListener('click',e=>{
          const href=a.getAttribute('href')||'';const m=href.match(/^data:([^;,]+);base64,([\s\S]+)$/);if(!m)return;
          e.preventDefault();e.stopPropagation();try{root.EARANative.saveBase64File(name||'Agent-Document',m[1],m[2]);if(typeof root.setStatus==='function')root.setStatus('Saving to Downloads…','busy')}catch(_){if(typeof root.setStatus==='function')root.setStatus('Could not save file','error')}
        });
      }
    }
  }
  function boot(){installAddFix();installPhoneCamera();installArtifactPipeline();improveFileLinks()}
  boot();setTimeout(boot,250);setTimeout(boot,900);
  new MutationObserver(improveFileLinks).observe(document.documentElement,{subtree:true,childList:true});
})(typeof window!=='undefined'?window:globalThis);
