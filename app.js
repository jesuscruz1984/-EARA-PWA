const $=s=>document.querySelector(s);
const DEFAULT_BACKEND='https://eara-pwa.jesuscruz1984.workers.dev';
const MEMKEY='earaMemoryV2';
const PERSONAKEY='earaPersona';
const VOICEKEY='earaVoice';
const DOCSESSIONKEY='earaDocumentSessionV1';

let stream=null,screenStream=null,lastReply='',lastSpeech='',cameraEnabled=true,micEnabled=true,screenSharing=false;

const personalities={helpful:'Helpful Assistant',concise:'Fast & Concise',expert:'Expert Analyst',companion:'Friendly Companion',fieldtech:'Field Technician',observer:'Curious Observer'};
const voices={asteria:'Asteria',luna:'Luna',athena:'Athena',stella:'Stella',angus:'Angus',orion:'Orion',perseus:'Perseus',zeus:'Zeus',helios:'Helios',hera:'Hera',arcas:'Arcas',orpheus:'Orpheus'};
const staleCapability=/\b(i(?:'m| am) (?:a )?large language model|i (?:do not|don't|cannot|can't) (?:see|hear|reply|respond|converse)|one-way communication|text-based inputs only|cannot visually|don't have the capability to visually|not capable of engaging in a conversation)\b/i;
const memoryStop=new Set(['the','and','that','this','with','from','have','what','when','where','were','your','you','our','notes','note','memory','memories','previous','earlier','past','before','about','through','look','find','tell','show','said','say','did','does']);

function backend(){return DEFAULT_BACKEND}
function badge(x){
  const text=$('#badgeText')||$('#badge');if(text)text.textContent=x;
  const spinner=$('#busySpinner');if(spinner)spinner.classList.toggle('hidden',!/thinking|starting|loading|searching|reconnecting|connecting|reading notes|reading document/i.test(String(x||'')));
}
function setState(x){const e=$('#state');if(e)e.textContent=x}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}

function memory(){try{return JSON.parse(localStorage.getItem(MEMKEY)||'[]')}catch(_){return []}}
function saveMemory(arr){localStorage.setItem(MEMKEY,JSON.stringify(arr.slice(-500)));const count=$('#memoryCount');if(count)count.textContent=`${Math.min(arr.length,500)} saved interactions`;const panel=$('#memory');if(panel&&!panel.classList.contains('hidden'))renderMemory()}
function addMemory(entry){const arr=memory();arr.push({...entry,ts:new Date().toISOString()});saveMemory(arr)}
function words(s){return new Set(String(s||'').toLowerCase().match(/[a-z0-9]{3,}/g)||[])}
function isMemoryRecallIntent(q){return /\b(previous|earlier|past|old|before|last time|our notes|my notes|saved notes|previous notes|memory notes|memory|memories|history|we discussed|we talked|what did we|what have we|go (?:to|through) (?:our )?(?:memory )?notes|look through (?:our )?(?:memory )?notes|review (?:our )?notes|search (?:our )?notes|from (?:our )?notes|saved interactions|recall|remember when)\b/i.test(String(q||''))}
function isReadAloudIntent(q){return /\b(read (?:me )?(?:that|this|the|it)?\s*(?:document|paper|letter|form|transcription|notes?)?(?: back)?(?: to me)?|read (?:the )?whole thing|read it all|read all of it|read everything|read aloud|say it all|speak (?:the )?(?:whole|full)|go (?:to|through) (?:our )?(?:memory )?notes and read)\b/i.test(String(q||''))}
function memoryContext(query,deep=false){
  const arr=memory().filter(m=>!staleCapability.test(String(m.assistant||'')));
  const raw=String(query||'').toLowerCase(),terms=[...words(query)].filter(w=>!memoryStop.has(w));
  const scored=arr.map((m,i)=>{
    const hay=((m.user||'')+' '+(m.assistant||'')).toLowerCase();
    let score=(i/Math.max(1,arr.length))*(deep?1:2);
    for(const w of terms){if(hay.includes(w))score+=hay.match(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}\\b`,'g'))?.length*6||4}
    if(raw.length>10&&hay.includes(raw))score+=18;
    return {m,score,i};
  }).sort((a,b)=>b.score-a.score);
  const selected=[];
  for(const x of scored){if(selected.length>=(deep?24:8))break;if(x.score>0.2||selected.length<4)selected.push(x.m)}
  if(deep){for(const m of arr.slice(-6)){if(!selected.includes(m))selected.push(m)}}
  const body=selected.map(m=>`[${new Date(m.ts).toLocaleString()}] User: ${String(m.user||'').slice(0,deep?700:450)}\nEARA: ${String(m.assistant||'').slice(0,deep?1100:650)}${m.vision?'\n[Vision frame processed]':''}`).join('\n\n');
  const head=deep?`[DEEP NOTE SEARCH: scanned ${arr.length} saved EARA interactions; strongest matches follow]\n\n`:'';
  return (head+body).slice(-(deep?16000:4800));
}

function getDocSession(){try{return JSON.parse(localStorage.getItem(DOCSESSIONKEY)||'{"active":false,"complete":false,"pages":[]}')}catch(_){return {active:false,complete:false,pages:[]}}}
function saveDocSession(s){localStorage.setItem(DOCSESSIONKEY,JSON.stringify(s))}
function startDocSession(){const s={active:true,complete:false,pages:[],startedAt:new Date().toISOString()};saveDocSession(s);return s}
function addDocPage(text,isLast=false){const s=getDocSession();s.active=true;const clean=String(text||'').trim();if(clean&&s.pages[s.pages.length-1]!==clean)s.pages.push(clean);if(isLast){s.complete=true;s.active=false}s.updatedAt=new Date().toISOString();saveDocSession(s);return s}
function documentHistory(){return getDocSession().pages.map((p,i)=>`Page ${i+1}.\n${p}`).join('\n\n').slice(-60000)}
function savedDocumentForReading(){const s=getDocSession();return Array.isArray(s.pages)?s.pages.map((p,i)=>`Page ${i+1}. ${String(p||'').trim()}`).filter(Boolean).join('\n\n').trim():''}
function resolveDocumentMode(q){
  const t=String(q||'').trim(),s=getDocSession();
  if(isReadAloudIntent(t)&&s.pages.length&&/\b(document|paper|letter|form|transcription|whole thing|it all|all of it|everything|read (?:that|this|it) back)\b/i.test(t))return 'readback';
  if(/\b(?:this is (?:the )?)?(?:last|final) page\b/i.test(t))return s.pages.length?'last':'start-last';
  if(s.active&&/^(?:next page|next|continue|continue reading|keep reading|read next|next section|go on)\b/i.test(t))return 'continue';
  if(/\b(?:read|transcribe|scan)\b[\s\S]{0,35}\b(?:this|the|that)?\s*(?:paper|document|letter|form|notice|page|contract|receipt)\b/i.test(t)||/^read\s+(?:this|that|it)\b/i.test(t))return 'start';
  if((s.pages.length||s.complete)&&(/\b(?:summari[sz]e|summary|explain|what did|what does|what was)\b[\s\S]{0,40}\b(?:paper|document|letter|form|pages?|it)\b/i.test(t)||/^(?:summari[sz]e|explain)\s+(?:it|this)\b/i.test(t)))return 'summary';
  return '';
}

function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function linkify(s){return esc(s).replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g,'<br>')}
function setReply(text){lastReply=String(text||'');$('#reply').innerHTML=linkify(lastReply);$('#copyReply').disabled=!lastReply;$('#speak').disabled=!lastReply}
function renderMemory(){const arr=memory(),count=$('#memoryCount');if(count)count.textContent=`${arr.length} saved interactions`;const box=$('#memoryList');if(!box)return;if(!arr.length){box.innerHTML='<div class="small">No memories yet. EARA will retain every question and AI response on this device.</div>';return}box.innerHTML=arr.slice(-100).reverse().map(m=>`<article class="mem"><div class="small">${new Date(m.ts).toLocaleString()} · ${esc(personalities[m.persona]||m.persona||'EARA')}${m.vision?' · Vision':''}</div><b>You:</b> <span>${linkify(m.user)}</span><br><b>EARA:</b> <span>${linkify(m.assistant)}</span></article>`).join('')}

async function chooseWideCamera(){try{const devices=await navigator.mediaDevices.enumerateDevices(),cams=devices.filter(d=>d.kind==='videoinput'),wide=cams.find(d=>/ultra\s*wide|0\.5|wide angle|back.*wide/i.test(d.label));if(!wide||!stream)return false;const current=stream.getVideoTracks()[0],vs=await navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:wide.deviceId},width:{ideal:1280},height:{ideal:720}},audio:false}),newTrack=vs.getVideoTracks()[0];if(current){stream.removeTrack(current);current.stop()}stream.addTrack(newTrack);if(!screenSharing){video.srcObject=stream;await video.play()}return true}catch(_){return false}}
async function applyMinZoom(){try{const t=stream?.getVideoTracks?.()[0],cap=t?.getCapabilities?.();if(cap?.zoom)await t.applyConstraints({advanced:[{zoom:cap.zoom.min}]})}catch(_){}}
async function optimizeCameraLater(){await sleep(50);await chooseWideCamera();await applyMinZoom()}
async function startMedia(silent=false){
  if(stream){if(micEnabled)window.forceEaraListening?.();badge(screenSharing?'Screen Live':'Eara Ready');return true}
  badge('Starting…');setState('Starting camera and microphone…');
  try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:window.EARANative?false:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});if(!screenSharing){video.srcObject=stream;await video.play()}cameraEnabled=true;micEnabled=true;$('#cam').textContent=screenSharing?'SCREEN VISION':'WIDE VISION';$('#cameraBtn').textContent='Disable Camera';$('#micBtn').textContent='Disable Mic';$('#permissionBtn').classList.add('hidden');$('#mediaControls').classList.remove('hidden');badge(screenSharing?'Screen Live':'Eara Ready');setState(screenSharing?'Screen sharing — say “Eara”':'Listening for “Eara”');window.dispatchEvent(new CustomEvent('eara-media-ready'));optimizeCameraLater();return true}catch(e){badge('Ready');if(!silent){$('#permissionBtn').classList.remove('hidden');setState('Tap Enable Camera + Mic once to grant permission.')}return false}
}
function stopCamera(){if(!stream)return;cameraEnabled=!cameraEnabled;stream.getVideoTracks().forEach(t=>t.enabled=cameraEnabled);$('#cameraBtn').textContent=cameraEnabled?'Disable Camera':'Enable Camera';if(!screenSharing)$('#cam').textContent=cameraEnabled?'WIDE VISION':'CAMERA PAUSED';if(micEnabled)window.forceEaraListening?.()}
function stopMic(){if(!stream)return;micEnabled=!micEnabled;stream.getAudioTracks().forEach(t=>t.enabled=micEnabled);$('#micBtn').textContent=micEnabled?'Disable Mic':'Enable Mic';if(micEnabled){window.dispatchEvent(new CustomEvent('eara-mic-enabled'));setTimeout(()=>window.forceEaraListening?.(),100)}else window.dispatchEvent(new CustomEvent('eara-mic-disabled'));setState(micEnabled?(screenSharing?'Screen sharing — say “Eara”':'Listening for “Eara”'):'Microphone disabled')}
function screenShareSupported(){return !!navigator.mediaDevices?.getDisplayMedia}
async function startScreenShare(){if(screenSharing)return true;if(!screenShareSupported()){const msg='Live screen sharing is not supported by iPhone Safari/PWA. EARA screen share works on supported desktop browsers; iPhone requires a native EARA app.';setState(msg);badge('Screen Share Unavailable');setReply(msg);lastSpeech='iPhone requires the native EARA app for live screen sharing.';window.say?.(lastSpeech);return false}try{const ds=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false}),track=ds.getVideoTracks()[0];if(!track)throw new Error('No screen video track returned');screenStream=ds;screenSharing=true;video.srcObject=screenStream;await video.play();$('#screenBtn').textContent='Stop Screen Share';$('#cam').textContent='SCREEN VISION';setState('Screen sharing — say “Eara”');badge('Screen Live');track.addEventListener('ended',()=>stopScreenShare(),{once:true});return true}catch(e){if(e?.name==='NotAllowedError'){setState('Screen sharing was canceled or blocked.');badge('Eara Ready');return false}setState('Screen share error: '+(e?.message||e));badge('Screen Error');return false}}
async function stopScreenShare(){if(screenStream){screenStream.getTracks().forEach(t=>{try{t.stop()}catch(_){}});screenStream=null}screenSharing=false;$('#screenBtn').textContent='Share Screen';if(stream){video.srcObject=stream;try{await video.play()}catch(_){}}$('#cam').textContent=cameraEnabled?'WIDE VISION':'CAMERA PAUSED';setState(micEnabled?'Listening for “Eara”':'Microphone disabled');badge('Eara Ready');if(micEnabled)window.forceEaraListening?.()}

function snap(highDetail=false){
  const c=$('#canvas');if(!c)return null;
  const vw=video.videoWidth||1280,vh=video.videoHeight||720;
  if(screenSharing||highDetail){const maxW=highDetail?1600:1100,scale=Math.min(1,maxW/vw);c.width=Math.max(640,Math.round(vw*scale));c.height=Math.max(360,Math.round(vh*scale));c.getContext('2d').drawImage(video,0,0,c.width,c.height);return c.toDataURL('image/jpeg',highDetail?.84:.65)}
  if(!stream||!cameraEnabled)return null;c.width=800;c.height=450;c.getContext('2d').drawImage(video,0,0,c.width,c.height);return c.toDataURL('image/jpeg',.60);
}
function needsVision(q,docMode=''){if(isMemoryRecallIntent(q)&&!docMode)return false;if(['start','start-last','continue','last'].includes(docMode))return true;if(screenSharing)return true;return /\b(see|look|looking|show|showing|camera|holding|hold|in my hand|in front|this|that|these|those|item|object|label|read|scan|identify|what is it|what is this|what's this|what am i holding|what i'm holding|picture|image|book|bottle|remote|device)\b/i.test(String(q||''))}

function friendlyError(message){const s=String(message||'');if(/3040|capacity temporarily exceeded|out of capacity|code["']?:["']?capacity/i.test(s))return 'AI capacity is temporarily busy. Try again in a few seconds.';if(/Tavily 4\d\d/i.test(s))return 'Live web search had a provider error. Try that search again.';if(/HTTP 5\d\d/i.test(s))return 'EARA hit a temporary server issue. Try again in a moment.';return 'Connection issue. Try again.'}
function fail(e){setReply(friendlyError(e?.message||e));setState(micEnabled?'Listening for “Eara”':'Error');badge('Temporary Error');$('#ai').textContent='AI retry available';if(micEnabled)setTimeout(()=>window.forceEaraListening?.(),250)}
async function fetchChat(payload){
  let lastRaw='',lastError=null;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const r=await fetch(backend()+'/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),cache:'no-store'}),raw=await r.text();lastRaw=raw;
      if(r.ok){const data=JSON.parse(raw);if(data?.text||data?.speech)return data;lastError=new Error('EARA received an empty answer');}
      else{lastError=new Error('HTTP '+r.status+': '+raw);if(r.status<500)throw lastError}
    }catch(e){lastError=e}
    if(attempt<2){setState(`AI retry ${attempt+2} of 3…`);badge('Reconnecting…');await sleep(250*(attempt+1))}
  }
  throw lastError||new Error(lastRaw||'Request failed');
}

async function askAI(text){
  const q=String(text||'').trim();if(!q)return;
  try{
    const docMode=resolveDocumentMode(q);if(docMode==='start'||docMode==='start-last')startDocSession();
    const deepMemory=isMemoryRecallIntent(q),readAloud=isReadAloudIntent(q),session=getDocSession();
    if(docMode==='readback'){
      const full=savedDocumentForReading();
      if(!full){const msg='I could not find a saved document transcription in our notes. Show me the document and say “Eara, read this paper” first.';setReply(msg);lastSpeech=msg;window.say?.(msg);return msg}
      const answer=`Saved document transcription (${session.pages.length} ${session.pages.length===1?'page':'pages'}):\n\n${full}`;
      setReply(answer);lastSpeech=full;addMemory({user:q,assistant:`Read the saved ${session.pages.length}-page document transcription aloud.`,persona:localStorage.getItem(PERSONAKEY)||'helpful',document:true,readAloud:true});
      $('#transcript').textContent='You: '+q;$('#ai').textContent='MEMORY DOCUMENT';badge('Eara Ready');setState('Reading saved document aloud…');window.say?.(full,{full:true});return answer
    }
    setState(deepMemory?'Searching previous notes…':(['start','start-last','continue','last'].includes(docMode)?'Reading document carefully…':'Thinking…'));
    badge(deepMemory?'Reading notes…':(['start','start-last','continue','last'].includes(docMode)?'Reading document…':'Thinking'));$('#ai').textContent=deepMemory?'MEMORY search…':(docMode?'DOCUMENT reading…':'AI thinking…');
    const useVision=needsVision(q,docMode),image=useVision?snap(['start','start-last','continue','last'].includes(docMode)):null,persona=localStorage.getItem(PERSONAKEY)||'helpful',mem=memoryContext(q,deepMemory);
    const requestText=screenSharing?`SCREEN SHARE ACTIVE. The attached image is the user's current shared screen, not the camera. Inspect the screen and answer the user's request: ${q}`:q;
    const j=await fetchChat({text:requestText,image,memory:mem,memoryMode:deepMemory?'deep':'normal',memoryCount:memory().length,personality:persona,visionActive:!!image,source:screenSharing?'screen':'camera',documentMode:docMode,documentHistory:documentHistory(),documentComplete:session.complete,documentPageCount:session.pages.length,readAloud});
    if(j.documentText){addDocPage(j.documentText,docMode==='last'||docMode==='start-last')}
    const answer=j.text||'No reply';lastSpeech=String(readAloud?answer:(j.speech||answer));setReply(answer);addMemory({user:q,assistant:answer,vision:!!image,persona,source:screenSharing?'screen':'camera',document:!!j.documentText});
    $('#transcript').textContent='You: '+q;$('#ai').textContent=j.memoryUsed?'MEMORY + AI':(j.documentText?'DOCUMENT + AI':(j.webUsed?'WEB + AI':(screenSharing&&image?'SCREEN + AI':(image?'VISION + AI':'AI ready'))));
    badge(screenSharing?'Screen Live':'Eara Ready');setState(window.isEaraActive?.()?'Eara active — keep talking':'Listening for “Eara”');window.say?.(lastSpeech,{full:readAloud});return answer;
  }catch(e){fail(e);throw e}
  finally{if(micEnabled&&!window.isEaraSpeakerEnabled?.())setTimeout(()=>window.forceEaraListening?.(),150)}
}

async function copyText(t){try{await navigator.clipboard.writeText(t);badge('Copied');setTimeout(()=>badge(screenSharing?'Screen Live':'Eara Ready'),700)}catch(_){}}
function setPersona(v){localStorage.setItem(PERSONAKEY,v);if($('#persona'))$('#persona').value=v;if($('#personaLiveSelect'))$('#personaLiveSelect').value=v;$('#personaLive').textContent=personalities[v]||v}
function setVoice(v){const safe=voices[v]?v:'asteria';localStorage.setItem(VOICEKEY,safe);if($('#voiceLiveSelect'))$('#voiceLiveSelect').value=safe;if($('#voiceCoreSelect'))$('#voiceCoreSelect').value=safe}

$('#permissionBtn').onclick=async()=>{await window.unlockEaraVoice?.();const ok=await startMedia(false);if(ok)window.forceEaraListening?.()};$('#cameraBtn').onclick=stopCamera;$('#micBtn').onclick=stopMic;$('#screenBtn').onclick=()=>screenSharing?stopScreenShare():startScreenShare();$('#ask').onclick=()=>{const t=$('#typed').value.trim();if(t){$('#typed').value='';askAI(t)}};$('#typed').addEventListener('keydown',e=>{if(e.key==='Enter')$('#ask').click()});$('#speak').onclick=()=>window.say?.(lastSpeech||lastReply);$('#copyReply').onclick=()=>copyText(lastReply);$('#copyMemory').onclick=()=>copyText(memory().map(m=>`[${new Date(m.ts).toLocaleString()}]\nYou: ${m.user}\nEARA: ${m.assistant}${m.vision?'\nVision frame processed':''}${m.source==='screen'?'\nSource: shared screen':''}`).join('\n\n'));$('#clearMemory').onclick=()=>{if(confirm('Clear all EARA memory saved on this device?'))saveMemory([])};if($('#persona'))$('#persona').onchange=e=>setPersona(e.target.value);

const controls=$('#mediaControls');if(controls){const wrap=document.createElement('div');wrap.style.marginTop='10px';wrap.innerHTML='<div class="small" style="margin-bottom:6px">Agent personality</div><select id="personaLiveSelect" style="width:100%"><option value="helpful">Helpful Assistant</option><option value="concise">Fast & Concise</option><option value="expert">Expert Analyst</option><option value="companion">Friendly Companion</option><option value="fieldtech">Field Technician</option><option value="observer">Curious Observer</option></select><div class="small" style="margin:10px 0 6px">Voice</div><select id="voiceLiveSelect" style="width:100%"><option value="asteria">Asteria</option><option value="luna">Luna</option><option value="athena">Athena</option><option value="stella">Stella</option><option value="angus">Angus</option><option value="orion">Orion</option><option value="perseus">Perseus</option><option value="zeus">Zeus</option><option value="helios">Helios</option><option value="hera">Hera</option><option value="arcas">Arcas</option><option value="orpheus">Orpheus</option></select><div class="small" style="margin-top:8px">AI: smart task routing + deep note recall + full document reading + GPT-OSS 120B complex reasoning. Web search uses Tavily first.</div>';controls.insertAdjacentElement('afterend',wrap);$('#personaLiveSelect').onchange=e=>setPersona(e.target.value);$('#voiceLiveSelect').onchange=e=>setVoice(e.target.value)}
const core=$('#settings .pad');if(core){const d=document.createElement('div');d.innerHTML='<div class="small" style="margin:12px 0 6px">Voice</div><select id="voiceCoreSelect" style="width:100%"><option value="asteria">Asteria</option><option value="luna">Luna</option><option value="athena">Athena</option><option value="stella">Stella</option><option value="angus">Angus</option><option value="orion">Orion</option><option value="perseus">Perseus</option><option value="zeus">Zeus</option><option value="helios">Helios</option><option value="hera">Hera</option><option value="arcas">Arcas</option><option value="orpheus">Orpheus</option></select>';core.appendChild(d);$('#voiceCoreSelect').onchange=e=>setVoice(e.target.value)}

setPersona(localStorage.getItem(PERSONAKEY)||'helpful');setVoice(localStorage.getItem(VOICEKEY)||'asteria');const existing=memory(),count=$('#memoryCount');if(count)count.textContent=`${existing.length} saved interactions`;document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('nav button').forEach(x=>x.classList.remove('active'));b.classList.add('active');['live','memory','tasks','settings'].forEach(id=>$('#'+id).classList.toggle('hidden',id!==b.dataset.tab));if(b.dataset.tab==='memory')renderMemory();if(micEnabled)setTimeout(()=>window.forceEaraListening?.(),80)});

if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});window.askAI=askAI;window.startMedia=startMedia;window.getEaraStream=()=>stream;window.isEaraMicEnabled=()=>micEnabled;window.getEaraVoice=()=>localStorage.getItem(VOICEKEY)||'asteria';window.isEaraScreenSharing=()=>screenSharing;
setTimeout(()=>startMedia(true).then(ok=>{if(!ok){$('#permissionBtn').classList.remove('hidden');setState('Tap Enable Camera + Mic once.');badge('Ready')}else setTimeout(()=>window.forceEaraListening?.(),120)}),120);
