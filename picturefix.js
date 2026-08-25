// EARA v31 single-photo capture + visible photo memory.
(()=>{
  const BACKEND='https://eara-pwa.jesuscruz1984.workers.dev',DB='earaMediaV1',STORE='pictures',MEMKEY='earaMemoryV2',PERSONAKEY='earaPersona';
  const $=s=>document.querySelector(s),sleep=ms=>new Promise(r=>setTimeout(r,ms));
  let wrapped=false;
  function persona(){return localStorage.getItem(PERSONAKEY)||'helpful'}
  function memory(){try{return JSON.parse(localStorage.getItem(MEMKEY)||'[]')}catch(_){return []}}
  function addMemory(entry){const a=memory();a.push({...entry,ts:new Date().toISOString()});localStorage.setItem(MEMKEY,JSON.stringify(a.slice(-500)));const c=$('#memoryCount');if(c)c.textContent=`${Math.min(a.length,500)} saved interactions`}
  function state(t){const e=$('#state');if(e)e.textContent=t}
  function badge(t){const e=$('#badgeText');if(e)e.textContent=t;const s=$('#busySpinner');if(s)s.classList.toggle('hidden',!/captur|saving|thinking|analyz/i.test(t))}
  function chip(t){const e=$('#ai');if(e)e.textContent=t}
  function openDb(){return new Promise((res,rej)=>{const q=indexedDB.open(DB,1);q.onupgradeneeded=()=>{if(!q.result.objectStoreNames.contains(STORE)){const st=q.result.createObjectStore(STORE,{keyPath:'id',autoIncrement:true});st.createIndex('ts','ts')}};q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)})}
  async function savePic(dataUrl,label){const db=await openDb();return new Promise((res,rej)=>{const q=db.transaction(STORE,'readwrite').objectStore(STORE).add({dataUrl,source:'camera photo',label,ts:Date.now()});q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)})}
  async function updatePic(id,patch){const db=await openDb();return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite'),st=tx.objectStore(STORE),q=st.get(Number(id));q.onsuccess=()=>{if(q.result)st.put({...q.result,...patch,updatedAt:Date.now()})};tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})}
  function crop(ctx,video,w,h){const sw=video.videoWidth||video.naturalWidth||video.width||1280,sh=video.videoHeight||video.naturalHeight||video.height||720,sr=sw/sh,dr=w/h;let sx=0,sy=0,sW=sw,sH=sh;if(sr>dr){sW=sh*dr;sx=(sw-sW)/2}else{sH=sw/dr;sy=(sh-sH)/2}ctx.drawImage(video,sx,sy,sW,sH,0,0,w,h)}
  function frame1080(){const v=$('#video');if(!v||!v.videoWidth)return '';const c=document.createElement('canvas');c.width=1920;c.height=1080;crop(c.getContext('2d'),v,1920,1080);return c.toDataURL('image/jpeg',.86)}
  function ensureUi(){
    const box=document.querySelector('.video');
    if(box&&!$('#earaShotOverlay')){const o=document.createElement('div');o.id='earaShotOverlay';o.innerHTML='<div id="earaShotLabel">PHOTO</div>';Object.assign(o.style,{position:'absolute',inset:'0',display:'none',alignItems:'center',justifyContent:'center',background:'rgba(255,255,255,.88)',color:'#03101b',fontSize:'30px',fontWeight:'900',zIndex:'8',pointerEvents:'none'});box.appendChild(o)}
    const pad=box?.parentElement?.querySelector('.pad');
    if(pad&&!$('#earaCaptureStrip')){const d=document.createElement('div');d.id='earaCaptureStrip';d.style.cssText='display:none;grid-template-columns:1fr;gap:7px;margin-top:9px';pad.insertBefore(d,$('#state')||null)}
    const old=$('#take3Btn');if(old)old.remove();
    if(pad&&!$('#takePhotoBtn')){const b=document.createElement('button');b.id='takePhotoBtn';b.textContent='Take Photo';b.style.cssText='width:100%;margin-top:9px';b.onclick=e=>{e.preventDefault();window.askAI?.('Look at this through the camera. Take one picture and save it to memory.')};pad.insertBefore(b,$('#state')||null)}
    const g=$('#pictureGallery'),m=$('#memoryList');if(g&&m&&g.parentElement&&g.parentElement.nextElementSibling!==m){m.parentElement.insertBefore(g.parentElement,m)}
  }
  async function flash(data){ensureUi();const o=$('#earaShotOverlay'),l=$('#earaShotLabel'),s=$('#earaCaptureStrip');if(l)l.textContent='PHOTO SAVED';if(o)o.style.display='flex';if(navigator.vibrate)try{navigator.vibrate(25)}catch(_){};await sleep(100);if(o)o.style.display='none';if(s){s.innerHTML='';s.style.display='grid';const img=document.createElement('img');img.src=data;img.style.cssText='width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:8px;border:1px solid #2d607c';s.appendChild(img)}}
  async function capture1(){ensureUi();const track=window.getEaraStream?.()?.getVideoTracks?.()?.[0];if(!track)throw new Error('Camera is not ready');if(track.enabled===false)track.enabled=true;try{await track.applyConstraints({width:{ideal:1920},height:{ideal:1080}})}catch(_){};await sleep(160);state('Taking photo…');badge('Capturing Photo');const f=frame1080();if(f)await flash(f);return f}
  async function askVision(prompt,img){const r=await fetch(BACKEND+'/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:prompt,image:img,memory:'',personality:persona(),visionActive:true,source:'camera photo'}),cache:'no-store'});const raw=await r.text();if(!r.ok)throw new Error(raw||`HTTP ${r.status}`);return JSON.parse(raw)}
  function cameraIntent(q){const t=String(q||'').toLowerCase();if(/\b(saved|uploaded|picture i uploaded|photo i uploaded|saved picture|saved photo)\b/.test(t))return false;if(/\b(document|paper|letter|form|receipt|page|next page|last page)\b/.test(t))return false;return /\b(look(?: at this| here)?|take a look|see this|check this out|what is this|what's this|what do you see|what am i holding|what i'm holding|show you this|take (?:a )?(?:picture|photo|pic)|save this|remember this)\b/.test(t)}
  async function handleCamera(q){
    const frame=await capture1();if(!frame)throw new Error('No camera picture was captured');const id=await savePic(frame,'Camera photo');state('Photo saved. Analyzing…');badge('Analyzing Photo');chip('PHOTO + AI');const j=await askVision(q,frame),answer=j.text||'I saved the picture, but could not identify enough detail.',speech=j.speech||answer;await updatePic(id,{analysis:answer});addMemory({user:`Camera picture saved: #${id}`,assistant:`Saved camera picture #${id} in EARA Memory. Analysis: ${answer}`,vision:true,picture:true,pictureIds:[id],source:'camera photo',persona:persona()});window.renderEaraPictures?.();const rep=$('#reply');if(rep)rep.textContent=answer;window.__earaLastReply=answer;window.__earaLastSpeech=speech;state(`Saved photo #${id} in Memory.`);badge('Photo Saved');chip('PHOTO + MEMORY');window.say?.(speech);return answer
  }
  function wrap(){if(wrapped||typeof window.askAI!=='function')return;const prev=window.askAI;window.askAI=async q=>{if(cameraIntent(q)){try{return await handleCamera(q)}catch(e){state('Camera picture error. Try again.');badge('Picture Error');throw e}}return prev(q)};wrapped=true}
  function refresh(){ensureUi();wrap();setTimeout(()=>{const g=$('#pictureGallery'),m=$('#memoryList');if(g&&m&&g.parentElement)m.parentElement.insertBefore(g.parentElement,m)},50)}
  window.addEventListener('eara-media-ready',refresh);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh()});setTimeout(refresh,50);setTimeout(refresh,700);
})();
