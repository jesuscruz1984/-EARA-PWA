(()=>{
  const BACKEND='https://eara-pwa.jesuscruz1984.workers.dev';
  const MEMKEY='earaMemoryV2';
  const PERSONAKEY='earaPersona';
  const DB='earaMediaV1';
  const STORE='pictures';
  const MAX_PICTURES=120;
  let selectedPictureId=null;
  let selectedPictureDataUrl='';
  let originalAskAI=null;

  const $=s=>document.querySelector(s);
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const linkify=s=>esc(s).replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g,'<br>');
  const persona=()=>localStorage.getItem(PERSONAKEY)||'helpful';
  const memory=()=>{try{return JSON.parse(localStorage.getItem(MEMKEY)||'[]')}catch(_){return []}};
  const saveMemory=arr=>{localStorage.setItem(MEMKEY,JSON.stringify(arr.slice(-500)));const c=$('#memoryCount');if(c)c.textContent=`${Math.min(arr.length,500)} saved interactions`;if(window.renderEaraPictures)window.renderEaraPictures()};
  const addMemory=entry=>{const arr=memory();arr.push({...entry,ts:new Date().toISOString()});saveMemory(arr)};
  function setBadge(text,busy=false){const e=$('#badgeText')||$('#badge');if(e)e.textContent=text;const sp=$('#busySpinner');if(sp)sp.classList.toggle('hidden',!busy)}
  function setState(text){const e=$('#state');if(e)e.textContent=text}
  function setChip(text){const e=$('#ai');if(e)e.textContent=text}
  function setReply(text){window.__earaLastReply=String(text||'');const e=$('#reply');if(e)e.innerHTML=linkify(window.__earaLastReply);const c=$('#copyReply');if(c)c.disabled=!window.__earaLastReply;const s=$('#speak');if(s)s.disabled=!window.__earaLastReply}
  function setTranscript(text){const e=$('#transcript');if(e)e.textContent='You: '+text}
  function friendlyError(message){const s=String(message||'');if(/3040|capacity temporarily exceeded|out of capacity/i.test(s))return 'AI capacity is temporarily busy. Try again in a few seconds.';if(/Tavily 4\d\d/i.test(s))return 'Live web search had a provider error. Try that search again.';if(/HTTP 5\d\d/i.test(s))return 'EARA hit a temporary server issue. Try again in a moment.';return 'Connection issue. Try again.'}

  function installReplyHandlers(){
    const copy=$('#copyReply');
    if(copy)copy.onclick=async()=>{try{await navigator.clipboard.writeText(window.__earaLastReply||'');setBadge('Copied');setTimeout(()=>setBadge('Eara Ready'),700)}catch(_){}};
    const speak=$('#speak');
    if(speak)speak.onclick=()=>window.say?.(window.__earaLastSpeech||window.__earaLastReply||'');
  }

  function openDb(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB,1);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains(STORE)){
          const st=db.createObjectStore(STORE,{keyPath:'id',autoIncrement:true});
          st.createIndex('ts','ts');
        }
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
  }
  async function allPictures(){
    const db=await openDb();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readonly');
      const req=tx.objectStore(STORE).getAll();
      req.onsuccess=()=>resolve((req.result||[]).sort((a,b)=>(a.ts||0)-(b.ts||0)));
      req.onerror=()=>reject(req.error);
    });
  }
  async function savePictureRecord(rec){
    const db=await openDb();
    const id=await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite');
      const req=tx.objectStore(STORE).add({...rec,ts:Date.now()});
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
    await trimPictures();
    return id;
  }
  async function deletePicture(id){
    const db=await openDb();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite');
      const req=tx.objectStore(STORE).delete(Number(id));
      req.onsuccess=()=>resolve(true);
      req.onerror=()=>reject(req.error);
    });
  }
  async function trimPictures(){
    const pics=await allPictures();
    if(pics.length<=MAX_PICTURES)return;
    const db=await openDb();
    const old=pics.slice(0,pics.length-MAX_PICTURES);
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite');
      const store=tx.objectStore(STORE);
      old.forEach(p=>store.delete(p.id));
      tx.oncomplete=()=>resolve(true);
      tx.onerror=()=>reject(tx.error);
    });
  }
  async function getPicture(id){
    const db=await openDb();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readonly');
      const req=tx.objectStore(STORE).get(Number(id));
      req.onsuccess=()=>resolve(req.result||null);
      req.onerror=()=>reject(req.error);
    });
  }

  async function renderPictures(){
    const count=$('#pictureCount'),gallery=$('#pictureGallery');
    if(!gallery)return;
    const pics=await allPictures();
    if(count)count.textContent=`${pics.length} saved pictures`;
    if(!pics.length){gallery.innerHTML='<div class="small">No saved pictures yet. Tap Add Pictures or say “Eara, look at this” to save burst frames.</div>';return}
    gallery.innerHTML=pics.slice(-24).reverse().map(p=>`<div class="eara-pic-card ${selectedPictureId===p.id?'active':''}" data-pic-card="${p.id}"><img src="${p.dataUrl}" alt="picture ${p.id}" data-pic-select="${p.id}"><div class="eara-pic-meta"><div>${esc(p.label||p.source||'picture')}</div><div>${new Date(p.ts||Date.now()).toLocaleString()}</div></div><div class="eara-pic-actions"><button type="button" data-pic-select="${p.id}">Use</button><button type="button" data-pic-delete="${p.id}">Delete</button></div></div>`).join('');
    gallery.querySelectorAll('[data-pic-select]').forEach(el=>el.addEventListener('click',async e=>{e.preventDefault();const id=e.currentTarget.getAttribute('data-pic-select');const pic=await getPicture(id);if(!pic)return;selectedPictureId=pic.id;selectedPictureDataUrl=pic.dataUrl;renderPictures();setState('Picture selected. Say “Eara, look at this picture.”');setBadge('Picture Ready')}));
    gallery.querySelectorAll('[data-pic-delete]').forEach(el=>el.addEventListener('click',async e=>{e.preventDefault();e.stopPropagation();const id=e.currentTarget.getAttribute('data-pic-delete');await deletePicture(id);if(Number(id)===selectedPictureId){selectedPictureId=null;selectedPictureDataUrl=''}renderPictures()}));
  }

  async function fileToDataUrl(file){
    const url=URL.createObjectURL(file);
    try{
      const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=url});
      const scale=Math.min(1,1920/img.width,1080/img.height);
      const w=Math.max(1,Math.round(img.width*scale)),h=Math.max(1,Math.round(img.height*scale));
      const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);
      return c.toDataURL('image/jpeg',0.86);
    }finally{URL.revokeObjectURL(url)}
  }

  async function handleFiles(list){
    const files=[...(list||[])].filter(f=>/^image\//i.test(f.type)).slice(0,10);
    if(!files.length)return;
    setBadge('Saving pictures…',true);setState('Processing selected pictures…');
    let lastId=null,lastData='';
    for(const file of files){const dataUrl=await fileToDataUrl(file);lastId=await savePictureRecord({dataUrl,source:'upload',label:file.name||'Uploaded picture'});lastData=dataUrl}
    selectedPictureId=lastId;selectedPictureDataUrl=lastData;await renderPictures();setState('Pictures saved. Say “Eara, look at this picture.”');setBadge('Picture Saved');
  }

  function cropDraw(ctx,img,x,y,w,h){
    const sw=img.videoWidth||img.naturalWidth||img.width||w,sh=img.videoHeight||img.naturalHeight||img.height||h;
    const srcRatio=sw/sh,dstRatio=w/h;let sx=0,sy=0,sWidth=sw,sHeight=sh;
    if(srcRatio>dstRatio){sWidth=sh*dstRatio;sx=(sw-sWidth)/2}else{sHeight=sw/dstRatio;sy=(sh-sHeight)/2}
    ctx.drawImage(img,sx,sy,sWidth,sHeight,x,y,w,h);
  }
  function captureFrame1080(){
    const video=$('#video');if(!video||!(video.videoWidth||video.clientWidth))return '';
    const c=document.createElement('canvas');c.width=1920;c.height=1080;const ctx=c.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,1920,1080);cropDraw(ctx,video,0,0,1920,1080);return c.toDataURL('image/jpeg',0.82);
  }
  async function prepare1080(){
    try{const track=window.getEaraStream?.()?.getVideoTracks?.()?.[0];if(!track)return;await track.applyConstraints({width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30}});await sleep(160)}catch(_){}
  }
  async function captureBurst(){
    await prepare1080();
    const frames=[];
    for(let i=0;i<3;i++){const frame=captureFrame1080();if(frame)frames.push(frame);if(i<2)await sleep(333)}
    return frames;
  }
  async function imageFromDataUrl(dataUrl){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=dataUrl})}
  async function burstCollage(frames){
    const imgs=await Promise.all(frames.map(imageFromDataUrl));const c=document.createElement('canvas');c.width=1920;c.height=1080;const ctx=c.getContext('2d');ctx.fillStyle='#020711';ctx.fillRect(0,0,1920,1080);
    const slots=[[0,0],[960,0],[0,540]],slotW=960,slotH=540;
    for(let i=0;i<imgs.length&&i<3;i++){cropDraw(ctx,imgs[i],slots[i][0],slots[i][1],slotW,slotH);ctx.fillStyle='rgba(0,0,0,.55)';ctx.fillRect(slots[i][0]+14,slots[i][1]+14,130,34);ctx.fillStyle='#fff';ctx.font='bold 22px sans-serif';ctx.fillText(`Frame ${i+1}`,slots[i][0]+28,slots[i][1]+38)}
    ctx.fillStyle='#0b1727';ctx.fillRect(960,540,960,540);ctx.fillStyle='#78e6ff';ctx.font='bold 26px sans-serif';ctx.fillText('3 fps vision burst',1005,612);ctx.fillStyle='#cfefff';ctx.font='18px sans-serif';ctx.fillText('EARA captured 3 camera frames at 1080p for this request.',1005,650);ctx.fillText('Use all visible frames when answering.',1005,682);return c.toDataURL('image/jpeg',0.86);
  }

  function isBurstIntent(q){const t=String(q||'').toLowerCase();if(/\b(document|paper|letter|form|contract|receipt|page|next page|last page)\b/i.test(t))return false;return /\b(look at this|look at these|check this out|see this|what do you see|what is this|what's this|inspect this|analyze this|identify this|look here|look at that|take a look|examine this|look at the item|look at this item)\b/i.test(t)}

  async function fetchChat(payload){
    let lastErr=null;
    for(let attempt=0;attempt<2;attempt++){
      try{const r=await fetch(BACKEND+'/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),cache:'no-store'});const raw=await r.text();if(!r.ok)throw new Error('HTTP '+r.status+': '+raw);return JSON.parse(raw)}catch(e){lastErr=e;await sleep(180*(attempt+1))}
    }
    throw lastErr||new Error('Request failed');
  }

  async function handlePictureQuery(query){
    const explicitStored=/(?:picture|photo|image|uploaded|saved picture|saved photo)/i.test(String(query||''));
    const useStored=!!selectedPictureDataUrl&&explicitStored;
    const canBurst=!!window.getEaraStream?.()&&!window.isEaraScreenSharing?.();
    const useBurst=!useStored&&canBurst&&isBurstIntent(query);
    if(!useStored&&!useBurst)return null;
    let image='',source='stored picture';
    if(useStored){image=selectedPictureDataUrl;setState('Using selected stored picture…');setBadge('Analyzing picture…',true)}else{
      setState('Capturing 3-frame 1080p burst…');setBadge('Capturing…',true);const frames=await captureBurst();if(!frames.length)throw new Error('No camera frame available');let n=1;for(const frame of frames)await savePictureRecord({dataUrl:frame,source:'camera burst',label:`Burst frame ${n++}`});await renderPictures();image=await burstCollage(frames);source='camera burst';
    }
    setState('Thinking…');setBadge('Thinking',true);setChip(source==='stored picture'?'PICTURE + AI':'BURST VISION + AI');
    const j=await fetchChat({text:query,image,memory:'',personality:persona(),visionActive:true,source});const answer=j.text||'No reply',speech=j.speech||answer;window.__earaLastReply=answer;window.__earaLastSpeech=speech;setReply(answer);setTranscript(query);addMemory({user:query,assistant:answer,vision:true,persona:persona(),source});setState('Listening for “Eara”');setBadge('Eara Ready');setChip(source==='stored picture'?'PICTURE + AI':'BURST VISION + AI');try{window.say?.(speech)}catch(_){}return answer;
  }

  function injectStyles(){
    if($('#eara-picture-style'))return;const style=document.createElement('style');style.id='eara-picture-style';style.textContent='.eara-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-top:10px}.eara-pic-card{background:#04101ddd;border:1px solid #214967;border-radius:14px;padding:8px}.eara-pic-card.active{outline:2px solid #55d7ff;border-color:#55d7ff}.eara-pic-card img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px;display:block;cursor:pointer}.eara-pic-meta{font-size:11px;color:#9dc0d5;margin-top:6px;min-height:42px}.eara-pic-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:7px}.eara-pic-actions button{min-height:34px;padding:8px;font-size:12px;border-radius:10px}';document.head.appendChild(style);
  }
  function installUi(){
    injectStyles();
    if(!$('#photoInput')){const inp=document.createElement('input');inp.id='photoInput';inp.type='file';inp.accept='image/*';inp.multiple=true;inp.className='hidden';inp.addEventListener('change',e=>handleFiles(e.target.files).finally(()=>{inp.value=''}));document.body.appendChild(inp)}
    const controls=$('#mediaControls'),mediaPad=controls?.parentElement;
    if(mediaPad&&!$('#photoBtn')){const btn=document.createElement('button');btn.id='photoBtn';btn.type='button';btn.textContent='Add Pictures';btn.style.width='100%';btn.style.marginTop='9px';btn.addEventListener('click',e=>{e.preventDefault();$('#photoInput')?.click()});const state=$('#state');mediaPad.insertBefore(btn,state||null)}
    const memPad=$('#memory .pad');if(memPad&&!$('#pictureGallery')){const wrap=document.createElement('div');wrap.innerHTML='<div style="margin-top:14px"><b>PICTURES // STORED</b><div id="pictureCount" class="small" style="margin-top:5px"></div><div class="small" style="margin-top:6px">Tap Add Pictures to upload images, or say “Eara, look at this” and EARA will save a 3 fps 1080p camera burst. Tap Use on any picture, then ask EARA about that picture.</div><div id="pictureGallery" class="eara-gallery"></div></div>';memPad.appendChild(wrap)}
    installReplyHandlers();document.querySelectorAll('nav button').forEach(b=>{if(b.dataset.pictureGalleryHook)return;b.dataset.pictureGalleryHook='1';b.addEventListener('click',()=>{if(b.dataset.tab==='memory')setTimeout(renderPictures,30)})});renderPictures();
  }
  function patchAskAI(){
    if(window.__earaPictureAskWrapped||typeof window.askAI!=='function')return;originalAskAI=window.askAI;window.askAI=async function(text){try{const handled=await handlePictureQuery(text);if(handled!==null)return handled}catch(e){const msg=friendlyError(e?.message||e);setReply(msg);window.__earaLastSpeech=msg;setState('Listening for “Eara”');setBadge('Temporary Error');setChip('AI retry available');throw e}return originalAskAI(text)};window.__earaPictureAskWrapped=true;
  }
  function installTypedInterception(){
    const ask=$('#ask'),typed=$('#typed');
    if(ask&&!ask.dataset.pictureHook){ask.dataset.pictureHook='1';ask.addEventListener('click',e=>{const q=String(typed?.value||'').trim();if(!q)return;const picQuery=(!!selectedPictureDataUrl&&/(?:picture|photo|image|uploaded|saved picture|saved photo)/i.test(q))||isBurstIntent(q);if(!picQuery)return;e.preventDefault();e.stopImmediatePropagation();typed.value='';window.askAI?.(q)},{capture:true})}
    if(typed&&!typed.dataset.pictureHook){typed.dataset.pictureHook='1';typed.addEventListener('keydown',e=>{if(e.key!=='Enter')return;const q=String(typed.value||'').trim();if(!q)return;const picQuery=(!!selectedPictureDataUrl&&/(?:picture|photo|image|uploaded|saved picture|saved photo)/i.test(q))||isBurstIntent(q);if(!picQuery)return;e.preventDefault();e.stopImmediatePropagation();typed.value='';window.askAI?.(q)},{capture:true})}
  }

  window.renderEaraPictures=renderPictures;
  window.addEventListener('eara-media-ready',()=>setTimeout(()=>{installUi();installTypedInterception()},20));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){installUi();installTypedInterception();patchAskAI()}});
  installUi();installTypedInterception();patchAskAI();
})();
