// EARA v29 picture memory + automatic image analysis + 3 fps 1080p burst vision.
(()=>{
  const BACKEND='https://eara-pwa.jesuscruz1984.workers.dev';
  const MEMKEY='earaMemoryV2';
  const PERSONAKEY='earaPersona';
  const DB='earaMediaV1';
  const STORE='pictures';
  const MAX_PICTURES=120;
  const SELECTED_CONTEXT_MS=5*60*1000;
  let selectedPictureId=null,selectedPictureDataUrl='',selectedAt=0,originalAskAI=null;

  const $=s=>document.querySelector(s);
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const linkify=s=>esc(s).replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g,'<br>');
  const persona=()=>localStorage.getItem(PERSONAKEY)||'helpful';
  const memory=()=>{try{return JSON.parse(localStorage.getItem(MEMKEY)||'[]')}catch(_){return []}};
  const saveMemory=arr=>{localStorage.setItem(MEMKEY,JSON.stringify(arr.slice(-500)));const c=$('#memoryCount');if(c)c.textContent=`${Math.min(arr.length,500)} saved interactions`};
  const addMemory=entry=>{const arr=memory();arr.push({...entry,ts:new Date().toISOString()});saveMemory(arr)};
  function setBadge(text,busy=false){const e=$('#badgeText')||$('#badge');if(e)e.textContent=text;const sp=$('#busySpinner');if(sp)sp.classList.toggle('hidden',!busy)}
  function setState(text){const e=$('#state');if(e)e.textContent=text}
  function setChip(text){const e=$('#ai');if(e)e.textContent=text}
  function setReply(text,speech=''){window.__earaLastReply=String(text||'');window.__earaLastSpeech=String(speech||text||'');const e=$('#reply');if(e)e.innerHTML=linkify(window.__earaLastReply);const c=$('#copyReply');if(c)c.disabled=!window.__earaLastReply;const s=$('#speak');if(s)s.disabled=!window.__earaLastReply}
  function setTranscript(text){const e=$('#transcript');if(e)e.textContent='You: '+text}
  function friendlyError(message){const s=String(message||'');if(/3040|capacity temporarily exceeded|out of capacity/i.test(s))return 'AI capacity is temporarily busy. Try again in a few seconds.';if(/HTTP 5\d\d/i.test(s))return 'EARA hit a temporary server issue. Try again in a moment.';return 'Picture analysis had a connection issue. Try again.'}

  function installReplyHandlers(){
    const copy=$('#copyReply');if(copy)copy.onclick=async()=>{try{await navigator.clipboard.writeText(window.__earaLastReply||'');setBadge('Copied');setTimeout(()=>setBadge('Eara Ready'),700)}catch(_){}};
    const speak=$('#speak');if(speak)speak.onclick=()=>window.say?.(window.__earaLastSpeech||window.__earaLastReply||'');
  }

  function openDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE)){const st=db.createObjectStore(STORE,{keyPath:'id',autoIncrement:true});st.createIndex('ts','ts')}};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
  async function allPictures(){const db=await openDb();return new Promise((resolve,reject)=>{const req=db.transaction(STORE,'readonly').objectStore(STORE).getAll();req.onsuccess=()=>resolve((req.result||[]).sort((a,b)=>(a.ts||0)-(b.ts||0)));req.onerror=()=>reject(req.error)})}
  async function savePictureRecord(rec){const db=await openDb();const id=await new Promise((resolve,reject)=>{const req=db.transaction(STORE,'readwrite').objectStore(STORE).add({...rec,ts:Date.now()});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});await trimPictures();return id}
  async function updatePictureRecord(id,patch){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite'),st=tx.objectStore(STORE),get=st.get(Number(id));get.onsuccess=()=>{if(!get.result){resolve(false);return}st.put({...get.result,...patch,updatedAt:Date.now()})};tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error)})}
  async function deletePicture(id){const db=await openDb();return new Promise((resolve,reject)=>{const req=db.transaction(STORE,'readwrite').objectStore(STORE).delete(Number(id));req.onsuccess=()=>resolve(true);req.onerror=()=>reject(req.error)})}
  async function getPicture(id){const db=await openDb();return new Promise((resolve,reject)=>{const req=db.transaction(STORE,'readonly').objectStore(STORE).get(Number(id));req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error)})}
  async function trimPictures(){const pics=await allPictures();if(pics.length<=MAX_PICTURES)return;const db=await openDb();await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite'),st=tx.objectStore(STORE);pics.slice(0,pics.length-MAX_PICTURES).forEach(p=>st.delete(p.id));tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})}

  function selectPicture(pic){selectedPictureId=pic?.id||null;selectedPictureDataUrl=pic?.dataUrl||'';selectedAt=Date.now()}
  function pictureNote(ids,label,analysis,source='picture'){
    const list=Array.isArray(ids)?ids:[ids];
    const tag=list.length===1?`Picture #${list[0]}`:`Pictures #${list.join(', #')}`;
    addMemory({user:`${tag} saved: ${label||source}`,assistant:`${tag} saved in EARA picture memory.${analysis?` Analysis: ${analysis}`:''}`,vision:true,persona:persona(),source,pictureIds:list,picture:true});
  }

  async function renderPictures(){
    const count=$('#pictureCount'),gallery=$('#pictureGallery');if(!gallery)return;
    const pics=await allPictures();if(count)count.textContent=`${pics.length} saved pictures`;
    if(!pics.length){gallery.innerHTML='<div class="small">No saved pictures yet. Add a picture or say “Eara, look at this.”</div>';return}
    gallery.innerHTML=pics.slice(-30).reverse().map(p=>`<div class="eara-pic-card ${selectedPictureId===p.id?'active':''}"><img src="${p.dataUrl}" alt="picture ${p.id}" data-pic-select="${p.id}"><div class="eara-pic-meta"><b>Picture #${p.id}</b><br>${esc(p.label||p.source||'picture')}<br>${new Date(p.ts||Date.now()).toLocaleString()}${p.analysis?`<div class="eara-pic-analysis">${esc(p.analysis)}</div>`:''}</div><div class="eara-pic-actions"><button type="button" data-pic-select="${p.id}">Use</button><button type="button" data-pic-analyze="${p.id}">Analyze</button><button type="button" data-pic-delete="${p.id}">Delete</button></div></div>`).join('');
    gallery.querySelectorAll('[data-pic-select]').forEach(el=>el.addEventListener('click',async e=>{e.preventDefault();const pic=await getPicture(e.currentTarget.getAttribute('data-pic-select'));if(!pic)return;selectPicture(pic);await renderPictures();setState('Picture selected. Ask EARA anything about it.');setBadge('Picture Ready')}));
    gallery.querySelectorAll('[data-pic-analyze]').forEach(el=>el.addEventListener('click',async e=>{e.preventDefault();const pic=await getPicture(e.currentTarget.getAttribute('data-pic-analyze'));if(pic)await analyzeStoredPicture(pic,'Analyze this saved picture. Identify the main object, visible text, model numbers, warnings, and any important details.')}));
    gallery.querySelectorAll('[data-pic-delete]').forEach(el=>el.addEventListener('click',async e=>{e.preventDefault();e.stopPropagation();const id=Number(e.currentTarget.getAttribute('data-pic-delete'));await deletePicture(id);if(id===selectedPictureId){selectedPictureId=null;selectedPictureDataUrl='';selectedAt=0}await renderPictures()}));
  }

  async function fileToDataUrl(file){const url=URL.createObjectURL(file);try{const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=url});const scale=Math.min(1,1920/img.width,1080/img.height),w=Math.max(1,Math.round(img.width*scale)),h=Math.max(1,Math.round(img.height*scale));const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);return c.toDataURL('image/jpeg',0.88)}finally{URL.revokeObjectURL(url)}}

  async function fetchChat(payload){let lastErr=null;for(let attempt=0;attempt<2;attempt++){try{const r=await fetch(BACKEND+'/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),cache:'no-store'}),raw=await r.text();if(!r.ok)throw new Error('HTTP '+r.status+': '+raw);return JSON.parse(raw)}catch(e){lastErr=e;if(attempt===0)await sleep(220)}}throw lastErr||new Error('Request failed')}
  async function analyzeImage(dataUrl,prompt,source){return fetchChat({text:prompt,image:dataUrl,memory:'',personality:persona(),visionActive:true,source})}

  async function analyzeStoredPicture(pic,prompt){
    selectPicture(pic);setBadge('Analyzing picture…',true);setState(`Analyzing picture #${pic.id}…`);setChip('PICTURE + AI');
    try{const j=await analyzeImage(pic.dataUrl,prompt,'stored picture'),answer=j.text||'I could not identify enough detail in this picture.',speech=j.speech||answer;await updatePictureRecord(pic.id,{analysis:answer});pictureNote(pic.id,pic.label||'Saved picture',answer,'stored picture');setReply(answer,speech);setTranscript(prompt);await renderPictures();setBadge('Eara Ready');setState('Listening for “Eara”');window.say?.(speech);return answer}catch(e){const msg=friendlyError(e?.message||e);setReply(msg,msg);setBadge('Picture Error');setState('Picture analysis failed. Try again.');throw e}
  }

  async function handleFiles(list){
    const files=[...(list||[])].filter(f=>/^image\//i.test(f.type)).slice(0,10);if(!files.length)return;
    const summaries=[];let lastPic=null;
    for(let i=0;i<files.length;i++){
      const file=files[i];setBadge(`Picture ${i+1}/${files.length}…`,true);setState(`Saving and analyzing ${file.name||`picture ${i+1}`}…`);
      const dataUrl=await fileToDataUrl(file),id=await savePictureRecord({dataUrl,source:'upload',label:file.name||`Uploaded picture ${i+1}`}),pic={id,dataUrl,label:file.name||`Uploaded picture ${i+1}`,source:'upload'};lastPic=pic;
      try{const j=await analyzeImage(dataUrl,'Analyze this uploaded picture. Identify the main object or scene, read useful visible text, model numbers, labels, warnings, and describe the important details.','uploaded picture'),analysis=j.text||'Picture saved, but no detailed analysis was returned.';await updatePictureRecord(id,{analysis});pictureNote(id,pic.label,analysis,'uploaded picture');summaries.push(`Picture #${id}: ${analysis}`)}catch(_){pictureNote(id,pic.label,'Saved, but automatic analysis failed. Tap Analyze to retry.','uploaded picture');summaries.push(`Picture #${id}: saved, but automatic analysis failed.`)}
    }
    if(lastPic)selectPicture(lastPic);await renderPictures();
    const answer=summaries.join('\n\n'),speech=files.length===1?(summaries[0]?.replace(/^Picture #\d+:\s*/,'')):`I saved and analyzed ${files.length} pictures. The results are in your memory notes.`;setReply(answer,speech);setBadge('Picture Saved');setState('Picture saved and analyzed in Memory.');setChip('PICTURE MEMORY');window.say?.(speech);
  }

  function cropDraw(ctx,img,x,y,w,h){const sw=img.videoWidth||img.naturalWidth||img.width||w,sh=img.videoHeight||img.naturalHeight||img.height||h,srcRatio=sw/sh,dstRatio=w/h;let sx=0,sy=0,sWidth=sw,sHeight=sh;if(srcRatio>dstRatio){sWidth=sh*dstRatio;sx=(sw-sWidth)/2}else{sHeight=sw/dstRatio;sy=(sh-sHeight)/2}ctx.drawImage(img,sx,sy,sWidth,sHeight,x,y,w,h)}
  function captureFrame1080(){const video=$('#video');if(!video||!(video.videoWidth||video.clientWidth))return '';const c=document.createElement('canvas');c.width=1920;c.height=1080;const ctx=c.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,1920,1080);cropDraw(ctx,video,0,0,1920,1080);return c.toDataURL('image/jpeg',0.84)}
  async function prepare1080(){try{const track=window.getEaraStream?.()?.getVideoTracks?.()?.[0];if(!track)return;await track.applyConstraints({width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30}});await sleep(180)}catch(_){}}
  async function captureBurst(){await prepare1080();const frames=[];for(let i=0;i<3;i++){const frame=captureFrame1080();if(frame)frames.push(frame);if(i<2)await sleep(333)}return frames}
  async function imageFromDataUrl(dataUrl){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=dataUrl})}
  async function burstCollage(frames){const imgs=await Promise.all(frames.map(imageFromDataUrl)),c=document.createElement('canvas');c.width=1920;c.height=1080;const ctx=c.getContext('2d');ctx.fillStyle='#020711';ctx.fillRect(0,0,1920,1080);const slots=[[0,0],[960,0],[0,540]];for(let i=0;i<imgs.length&&i<3;i++){cropDraw(ctx,imgs[i],slots[i][0],slots[i][1],960,540);ctx.fillStyle='rgba(0,0,0,.55)';ctx.fillRect(slots[i][0]+14,slots[i][1]+14,130,34);ctx.fillStyle='#fff';ctx.font='bold 22px sans-serif';ctx.fillText(`Frame ${i+1}`,slots[i][0]+28,slots[i][1]+38)}ctx.fillStyle='#0b1727';ctx.fillRect(960,540,960,540);ctx.fillStyle='#78e6ff';ctx.font='bold 26px sans-serif';ctx.fillText('EARA 3 fps 1080p burst',1005,612);ctx.fillStyle='#cfefff';ctx.font='18px sans-serif';ctx.fillText('Three saved frames are shown for comparison.',1005,650);return c.toDataURL('image/jpeg',0.88)}

  function isBurstIntent(q){const t=String(q||'').toLowerCase();if(/\b(document|paper|letter|form|contract|receipt|page|next page|last page)\b/i.test(t))return false;return /\b(look at this|look at these|check this out|see this|what do you see|what is this|what's this|inspect this|analyze this|identify this|look here|look at that|take a look|examine this|what am i holding|what i'm holding|take (?:a )?(?:picture|photo)|save this (?:picture|photo|image)?|remember this (?:picture|photo|image)?)\b/i.test(t)}
  function explicitStoredIntent(q){return /\b(picture|photo|image|uploaded|saved picture|saved photo|saved image|picture i uploaded|photo i uploaded)\b/i.test(String(q||''))}
  function cameraExplicit(q){return /\b(camera|through the camera|in front of (?:the )?camera|what am i holding|what i'm holding|in my hand|right now|live)\b/i.test(String(q||''))}
  function selectedFollowup(q){if(!selectedPictureDataUrl||Date.now()-selectedAt>SELECTED_CONTEXT_MS)return false;const t=String(q||'').trim();return t.length<180&&/\b(it|this|that|picture|photo|image|model|number|label|text|brand|color|read|what else|tell me more|zoom|warning|serial)\b/i.test(t)}
  function shouldUseSelected(q){return !!selectedPictureDataUrl&&!cameraExplicit(q)&&(explicitStoredIntent(q)||isBurstIntent(q)||selectedFollowup(q))}

  async function handlePictureQuery(query){
    const useStored=shouldUseSelected(query),canBurst=!!window.getEaraStream?.()&&!window.isEaraScreenSharing?.(),useBurst=!useStored&&canBurst&&isBurstIntent(query);if(!useStored&&!useBurst)return null;
    if(useStored){const pic=await getPicture(selectedPictureId);if(!pic){selectedPictureId=null;selectedPictureDataUrl='';return null}return analyzeStoredPicture(pic,query)}
    setState('Capturing 3-frame 1080p burst…');setBadge('Capturing…',true);setChip('BURST VISION');
    const frames=await captureBurst();if(!frames.length)throw new Error('No camera frame available');const ids=[];
    for(let i=0;i<frames.length;i++)ids.push(await savePictureRecord({dataUrl:frames[i],source:'camera burst',label:`Camera burst frame ${i+1}`}));
    const selectedIndex=Math.min(1,frames.length-1);selectPicture({id:ids[selectedIndex],dataUrl:frames[selectedIndex]});await renderPictures();
    const collage=await burstCollage(frames);setState('Analyzing saved camera pictures…');setBadge('Thinking',true);
    const j=await analyzeImage(collage,query,'camera burst'),answer=j.text||'I saved the pictures but could not identify enough detail.',speech=j.speech||answer;
    for(const id of ids)await updatePictureRecord(id,{analysis:answer,burstIds:ids});pictureNote(ids,'3 fps 1080p camera burst',answer,'camera burst');setReply(answer,speech);setTranscript(query);setBadge('Eara Ready');setState('Pictures saved in Memory. Listening for “Eara”');setChip('BURST + MEMORY');await renderPictures();window.say?.(speech);return answer;
  }

  function injectStyles(){if($('#eara-picture-style'))return;const style=document.createElement('style');style.id='eara-picture-style';style.textContent='.eara-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));gap:10px;margin-top:10px}.eara-pic-card{background:#04101ddd;border:1px solid #214967;border-radius:14px;padding:8px}.eara-pic-card.active{outline:2px solid #55d7ff;border-color:#55d7ff}.eara-pic-card img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px;display:block}.eara-pic-meta{font-size:11px;color:#9dc0d5;margin-top:6px}.eara-pic-analysis{margin-top:6px;color:#d8edf8;line-height:1.3}.eara-pic-actions{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-top:7px}.eara-pic-actions button{min-height:34px;padding:6px;font-size:11px;border-radius:9px}';document.head.appendChild(style)}
  function installUi(){
    injectStyles();if(!$('#photoInput')){const inp=document.createElement('input');inp.id='photoInput';inp.type='file';inp.accept='image/*';inp.multiple=true;inp.className='hidden';inp.addEventListener('change',e=>handleFiles(e.target.files).catch(err=>{const msg=friendlyError(err?.message||err);setReply(msg,msg);setBadge('Picture Error');setState(msg)}).finally(()=>{inp.value=''}));document.body.appendChild(inp)}
    const controls=$('#mediaControls'),mediaPad=controls?.parentElement;if(mediaPad&&!$('#photoBtn')){const btn=document.createElement('button');btn.id='photoBtn';btn.type='button';btn.textContent='Add & Analyze Pictures';btn.style.width='100%';btn.style.marginTop='9px';btn.addEventListener('click',e=>{e.preventDefault();$('#photoInput')?.click()});mediaPad.insertBefore(btn,$('#state')||null)}
    const memPad=$('#memory .pad');if(memPad&&!$('#pictureGallery')){const wrap=document.createElement('div');wrap.innerHTML='<div style="margin-top:14px"><b>PICTURE MEMORY NOTES</b><div id="pictureCount" class="small" style="margin-top:5px"></div><div class="small" style="margin-top:6px">Uploaded pictures are analyzed automatically. Camera commands such as “Eara, look at this” save three 1080p frames at about 3 fps, analyze them, and add the result to Memory notes.</div><div id="pictureGallery" class="eara-gallery"></div></div>';memPad.appendChild(wrap)}
    installReplyHandlers();document.querySelectorAll('nav button').forEach(b=>{if(b.dataset.pictureGalleryHook)return;b.dataset.pictureGalleryHook='1';b.addEventListener('click',()=>{if(b.dataset.tab==='memory')setTimeout(renderPictures,30)})});renderPictures();
  }
  function patchAskAI(){if(window.__earaPictureAskWrapped||typeof window.askAI!=='function')return;originalAskAI=window.askAI;window.askAI=async function(text){try{const handled=await handlePictureQuery(text);if(handled!==null)return handled}catch(e){const msg=friendlyError(e?.message||e);setReply(msg,msg);setState('Listening for “Eara”');setBadge('Temporary Error');setChip('AI retry available');throw e}const answer=await originalAskAI(text);if(answer){window.__earaLastReply=String(answer);window.__earaLastSpeech=String(answer)}return answer};window.__earaPictureAskWrapped=true}
  function isPictureQuery(q){return shouldUseSelected(q)||isBurstIntent(q)}
  function installTypedInterception(){const ask=$('#ask'),typed=$('#typed');if(ask&&!ask.dataset.pictureHook){ask.dataset.pictureHook='1';ask.addEventListener('click',e=>{const q=String(typed?.value||'').trim();if(!q||!isPictureQuery(q))return;e.preventDefault();e.stopImmediatePropagation();typed.value='';window.askAI?.(q)},{capture:true})}if(typed&&!typed.dataset.pictureHook){typed.dataset.pictureHook='1';typed.addEventListener('keydown',e=>{if(e.key!=='Enter')return;const q=String(typed.value||'').trim();if(!q||!isPictureQuery(q))return;e.preventDefault();e.stopImmediatePropagation();typed.value='';window.askAI?.(q)},{capture:true})}}

  window.renderEaraPictures=renderPictures;window.addEventListener('eara-media-ready',()=>setTimeout(()=>{installUi();installTypedInterception()},20));document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){installUi();installTypedInterception();patchAskAI()}});installUi();installTypedInterception();patchAskAI();
})();
