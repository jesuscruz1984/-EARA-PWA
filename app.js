const $=s=>document.querySelector(s);
const DEFAULT_BACKEND='https://eara-pwa.jesuscruz1984.workers.dev';
const MEMKEY='earaMemoryV2';
const PERSONAKEY='earaPersona';
const VOICEKEY='earaVoice';

let stream=null,screenStream=null,lastReply='',lastSpeech='',cameraEnabled=true,micEnabled=true,screenSharing=false;

const personalities={helpful:'Helpful Assistant',concise:'Fast & Concise',expert:'Expert Analyst',companion:'Friendly Companion',fieldtech:'Field Technician',observer:'Curious Observer'};
const voices={asteria:'Asteria',luna:'Luna',athena:'Athena',stella:'Stella',angus:'Angus',orion:'Orion',perseus:'Perseus',zeus:'Zeus',helios:'Helios',hera:'Hera',arcas:'Arcas',orpheus:'Orpheus'};
const staleCapability=/\b(i(?:'m| am) (?:a )?large language model|i (?:do not|don't|cannot|can't) (?:see|hear|reply|respond|converse)|one-way communication|text-based inputs only|cannot visually|don't have the capability to visually|not capable of engaging in a conversation)\b/i;

function backend(){return DEFAULT_BACKEND}
function badge(x){
  const text=$('#badgeText')||$('#badge');
  if(text)text.textContent=x;
  const spinner=$('#busySpinner');
  if(spinner)spinner.classList.toggle('hidden',!/thinking|starting|loading|searching|reconnecting|connecting/i.test(String(x||'')));
}
function setState(x){const e=$('#state');if(e)e.textContent=x}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}

function memory(){try{return JSON.parse(localStorage.getItem(MEMKEY)||'[]')}catch(_){return []}}
function saveMemory(arr){
  localStorage.setItem(MEMKEY,JSON.stringify(arr.slice(-500)));
  const count=$('#memoryCount');if(count)count.textContent=`${Math.min(arr.length,500)} saved interactions`;
  const panel=$('#memory');if(panel&&!panel.classList.contains('hidden'))renderMemory();
}
function addMemory(entry){const arr=memory();arr.push({...entry,ts:new Date().toISOString()});saveMemory(arr)}
function words(s){return new Set(String(s||'').toLowerCase().match(/[a-z0-9]{3,}/g)||[])}
function memoryContext(query){
  const q=words(query),arr=memory().filter(m=>!staleCapability.test(String(m.assistant||'')));
  const picked=arr.map((m,i)=>{let score=i/Math.max(1,arr.length)*2;const hay=words((m.user||'')+' '+(m.assistant||''));q.forEach(w=>{if(hay.has(w))score+=4});return {m,score}})
    .sort((a,b)=>b.score-a.score).slice(0,8).map(x=>x.m).reverse();
  return picked.map(m=>`[${new Date(m.ts).toLocaleString()}] User: ${String(m.user||'').slice(0,450)}\nEARA: ${String(m.assistant||'').slice(0,650)}${m.vision?'\n[Vision frame processed]':''}`).join('\n\n').slice(-4800);
}

function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function linkify(s){return esc(s).replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g,'<br>')}
function setReply(text){lastReply=String(text||'');$('#reply').innerHTML=linkify(lastReply);$('#copyReply').disabled=!lastReply;$('#speak').disabled=!lastReply}
function renderMemory(){
  const arr=memory(),count=$('#memoryCount');if(count)count.textContent=`${arr.length} saved interactions`;
  const box=$('#memoryList');if(!box)return;
  if(!arr.length){box.innerHTML='<div class="small">No memories yet. EARA will retain every question and AI response on this device.</div>';return}
  box.innerHTML=arr.slice(-100).reverse().map(m=>`<article class="mem"><div class="small">${new Date(m.ts).toLocaleString()} · ${esc(personalities[m.persona]||m.persona||'EARA')}${m.vision?' · Vision':''}</div><b>You:</b> <span>${linkify(m.user)}</span><br><b>EARA:</b> <span>${linkify(m.assistant)}</span></article>`).join('');
}

async function chooseWideCamera(){
  try{
    const devices=await navigator.mediaDevices.enumerateDevices();
    const cams=devices.filter(d=>d.kind==='videoinput');
    const wide=cams.find(d=>/ultra\s*wide|0\.5|wide angle|back.*wide/i.test(d.label));
    if(!wide||!stream)return false;
    const current=stream.getVideoTracks()[0];
    const vs=await navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:wide.deviceId},width:{ideal:1280},height:{ideal:720}},audio:false});
    const newTrack=vs.getVideoTracks()[0];
    if(current){stream.removeTrack(current);current.stop()}
    stream.addTrack(newTrack);
    if(!screenSharing){video.srcObject=stream;await video.play()}
    return true;
  }catch(_){return false}
}
async function applyMinZoom(){try{const t=stream?.getVideoTracks?.()[0],cap=t?.getCapabilities?.();if(cap?.zoom)await t.applyConstraints({advanced:[{zoom:cap.zoom.min}]})}catch(_){}}
async function optimizeCameraLater(){await sleep(50);await chooseWideCamera();await applyMinZoom()}

async function startMedia(silent=false){
  if(stream){if(micEnabled)window.forceEaraListening?.();badge(screenSharing?'Screen Live':'Eara Ready');return true}
  badge('Starting…');setState('Starting camera and microphone…');
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    if(!screenSharing){video.srcObject=stream;await video.play()}
    cameraEnabled=true;micEnabled=true;
    $('#cam').textContent=screenSharing?'SCREEN VISION':'WIDE VISION';
    $('#cameraBtn').textContent='Disable Camera';$('#micBtn').textContent='Disable Mic';
    $('#permissionBtn').classList.add('hidden');$('#mediaControls').classList.remove('hidden');
    badge(screenSharing?'Screen Live':'Eara Ready');
    setState(screenSharing?'Screen sharing — say “Eara”':'Listening for “Eara”');
    window.dispatchEvent(new CustomEvent('eara-media-ready'));
    optimizeCameraLater();
    return true;
  }catch(e){
    badge('Ready');
    if(!silent){$('#permissionBtn').classList.remove('hidden');setState('Tap Enable Camera + Mic once to grant permission.')}
    return false;
  }
}

function stopCamera(){if(!stream)return;cameraEnabled=!cameraEnabled;stream.getVideoTracks().forEach(t=>t.enabled=cameraEnabled);$('#cameraBtn').textContent=cameraEnabled?'Disable Camera':'Enable Camera';if(!screenSharing)$('#cam').textContent=cameraEnabled?'WIDE VISION':'CAMERA PAUSED';if(micEnabled)window.forceEaraListening?.()}
function stopMic(){
  if(!stream)return;micEnabled=!micEnabled;stream.getAudioTracks().forEach(t=>t.enabled=micEnabled);$('#micBtn').textContent=micEnabled?'Disable Mic':'Enable Mic';
  if(micEnabled){window.dispatchEvent(new CustomEvent('eara-mic-enabled'));setTimeout(()=>window.forceEaraListening?.(),100)}else window.dispatchEvent(new CustomEvent('eara-mic-disabled'));
  setState(micEnabled?(screenSharing?'Screen sharing — say “Eara”':'Listening for “Eara”'):'Microphone disabled');
}

function screenShareSupported(){return !!navigator.mediaDevices?.getDisplayMedia}
async function startScreenShare(){
  if(screenSharing)return true;
  if(!screenShareSupported()){
    const msg='Live screen sharing is not supported by iPhone Safari/PWA. EARA screen share works on supported desktop browsers; iPhone requires a native EARA app.';
    setState(msg);badge('Screen Share Unavailable');setReply(msg);lastSpeech='iPhone requires the native EARA app for live screen sharing.';window.say?.(lastSpeech);return false;
  }
  try{
    const ds=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false}),track=ds.getVideoTracks()[0];if(!track)throw new Error('No screen video track returned');
    screenStream=ds;screenSharing=true;video.srcObject=screenStream;await video.play();$('#screenBtn').textContent='Stop Screen Share';$('#cam').textContent='SCREEN VISION';setState('Screen sharing — say “Eara”');badge('Screen Live');track.addEventListener('ended',()=>stopScreenShare(),{once:true});return true;
  }catch(e){if(e?.name==='NotAllowedError'){setState('Screen sharing was canceled or blocked.');badge('Eara Ready');return false}setState('Screen share error: '+(e?.message||e));badge('Screen Error');return false}
}
async function stopScreenShare(){
  if(screenStream){screenStream.getTracks().forEach(t=>{try{t.stop()}catch(_){}});screenStream=null}
  screenSharing=false;$('#screenBtn').textContent='Share Screen';if(stream){video.srcObject=stream;try{await video.play()}catch(_){}}
  $('#cam').textContent=cameraEnabled?'WIDE VISION':'CAMERA PAUSED';setState(micEnabled?'Listening for “Eara”':'Microphone disabled');badge('Eara Ready');if(micEnabled)window.forceEaraListening?.();
}

function snap(){
  const c=$('#canvas');
  if(screenSharing){c.width=Math.min(video.videoWidth||960,960);c.height=Math.round(c.width*9/16);c.getContext('2d').drawImage(video,0,0,c.width,c.height);return c.toDataURL('image/jpeg',.60)}
  if(!stream||!cameraEnabled)return null;
  c.width=800;c.height=450;c.getContext('2d').drawImage(video,0,0,c.width,c.height);return c.toDataURL('image/jpeg',.60);
}
function needsVision(q){if(screenSharing)return true;return /\b(see|look|looking|show|showing|camera|holding|hold|in my hand|in front|this|that|these|those|item|object|label|read|scan|identify|what is it|what is this|what's this|what am i holding|what i'm holding|picture|image|book|bottle|remote|device)\b/i.test(String(q||''))}

function friendlyError(message){const s=String(message||'');if(/3040|capacity temporarily exceeded|out of capacity|code["']?:["']?capacity/i.test(s))return 'AI capacity is temporarily busy. Try again in a few seconds.';if(/Tavily 4\d\d/i.test(s))return 'Live web search had a provider error. Try that search again.';if(/HTTP 5\d\d/i.test(s))return 'EARA hit a temporary server issue. Try again in a moment.';return 'Connection issue. Try again.'}
function fail(e){setReply(friendlyError(e?.message||e));setState(micEnabled?'Listening for “Eara”':'Error');badge('Temporary Error');$('#ai').textContent='AI retry available';if(micEnabled)setTimeout(()=>window.forceEaraListening?.(),250)}

async function fetchChat(payload){
  let lastRaw='';
  for(let attempt=0;attempt<2;attempt++){
    const r=await fetch(backend()+'/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),cache:'no-store'});
    const raw=await r.text();lastRaw=raw;if(r.ok)return JSON.parse(raw);
    const retryable=r.status>=500&&/3040|capacity|temporarily|busy/i.test(raw);if(retryable&&attempt===0){await sleep(250);continue}
    throw new Error('HTTP '+r.status+': '+raw);
  }
  throw new Error(lastRaw||'Request failed');
}

async function askAI(text){
  const q=String(text||'').trim();if(!q)return;
  try{
    setState('Thinking…');badge('Thinking');$('#ai').textContent='AI thinking…';
    const useVision=needsVision(q),image=useVision?snap():null,persona=localStorage.getItem(PERSONAKEY)||'helpful',mem=memoryContext(q);
    const requestText=screenSharing?`SCREEN SHARE ACTIVE. The attached image is the user's current shared screen, not the camera. Inspect the screen and answer the user's request: ${q}`:q;
    const j=await fetchChat({text:requestText,image,memory:mem,personality:persona,visionActive:!!image,source:screenSharing?'screen':'camera'});
    const answer=j.text||'No reply';lastSpeech=String(j.speech||answer);setReply(answer);
    addMemory({user:q,assistant:answer,vision:!!image,persona,source:screenSharing?'screen':'camera'});
    $('#transcript').textContent='You: '+q;$('#ai').textContent=j.webUsed?'WEB + AI':(screenSharing&&image?'SCREEN + AI':(image?'VISION + AI':'AI ready'));
    badge(screenSharing?'Screen Live':'Eara Ready');setState(window.isEaraActive?.()?'Eara active — keep talking':'Listening for “Eara”');
    window.say?.(lastSpeech);return answer;
  }catch(e){fail(e);throw e}
  finally{if(micEnabled&&!window.isEaraSpeakerEnabled?.())setTimeout(()=>window.forceEaraListening?.(),150)}
}

async function copyText(t){try{await navigator.clipboard.writeText(t);badge('Copied');setTimeout(()=>badge(screenSharing?'Screen Live':'Eara Ready'),700)}catch(_){}}
function setPersona(v){localStorage.setItem(PERSONAKEY,v);if($('#persona'))$('#persona').value=v;if($('#personaLiveSelect'))$('#personaLiveSelect').value=v;$('#personaLive').textContent=personalities[v]||v}
function setVoice(v){const safe=voices[v]?v:'asteria';localStorage.setItem(VOICEKEY,safe);if($('#voiceLiveSelect'))$('#voiceLiveSelect').value=safe;if($('#voiceCoreSelect'))$('#voiceCoreSelect').value=safe}

$('#permissionBtn').onclick=async()=>{await window.unlockEaraVoice?.();const ok=await startMedia(false);if(ok)window.forceEaraListening?.()};
$('#cameraBtn').onclick=stopCamera;$('#micBtn').onclick=stopMic;$('#screenBtn').onclick=()=>screenSharing?stopScreenShare():startScreenShare();
$('#ask').onclick=()=>{const t=$('#typed').value.trim();if(t){$('#typed').value='';askAI(t)}};
$('#typed').addEventListener('keydown',e=>{if(e.key==='Enter')$('#ask').click()});
$('#speak').onclick=()=>window.say?.(lastSpeech||lastReply);$('#copyReply').onclick=()=>copyText(lastReply);
$('#copyMemory').onclick=()=>copyText(memory().map(m=>`[${new Date(m.ts).toLocaleString()}]\nYou: ${m.user}\nEARA: ${m.assistant}${m.vision?'\nVision frame processed':''}${m.source==='screen'?'\nSource: shared screen':''}`).join('\n\n'));
$('#clearMemory').onclick=()=>{if(confirm('Clear all EARA memory saved on this device?'))saveMemory([])};
if($('#persona'))$('#persona').onchange=e=>setPersona(e.target.value);

const controls=$('#mediaControls');
if(controls){
  const wrap=document.createElement('div');wrap.style.marginTop='10px';
  wrap.innerHTML='<div class="small" style="margin-bottom:6px">Agent personality</div><select id="personaLiveSelect" style="width:100%"><option value="helpful">Helpful Assistant</option><option value="concise">Fast & Concise</option><option value="expert">Expert Analyst</option><option value="companion">Friendly Companion</option><option value="fieldtech">Field Technician</option><option value="observer">Curious Observer</option></select><div class="small" style="margin:10px 0 6px">Voice</div><select id="voiceLiveSelect" style="width:100%"><option value="asteria">Asteria</option><option value="luna">Luna</option><option value="athena">Athena</option><option value="stella">Stella</option><option value="angus">Angus</option><option value="orion">Orion</option><option value="perseus">Perseus</option><option value="zeus">Zeus</option><option value="helios">Helios</option><option value="hera">Hera</option><option value="arcas">Arcas</option><option value="orpheus">Orpheus</option></select><div class="small" style="margin-top:8px">AI: fast-response routing + GPT-OSS 120B for complex reasoning + resilient live vision. Web search uses Tavily first.</div>';
  controls.insertAdjacentElement('afterend',wrap);$('#personaLiveSelect').onchange=e=>setPersona(e.target.value);$('#voiceLiveSelect').onchange=e=>setVoice(e.target.value);
}
const core=$('#settings .pad');
if(core){const d=document.createElement('div');d.innerHTML='<div class="small" style="margin:12px 0 6px">Voice</div><select id="voiceCoreSelect" style="width:100%"><option value="asteria">Asteria</option><option value="luna">Luna</option><option value="athena">Athena</option><option value="stella">Stella</option><option value="angus">Angus</option><option value="orion">Orion</option><option value="perseus">Perseus</option><option value="zeus">Zeus</option><option value="helios">Helios</option><option value="hera">Hera</option><option value="arcas">Arcas</option><option value="orpheus">Orpheus</option></select>';core.appendChild(d);$('#voiceCoreSelect').onchange=e=>setVoice(e.target.value)}

setPersona(localStorage.getItem(PERSONAKEY)||'helpful');setVoice(localStorage.getItem(VOICEKEY)||'asteria');
const existing=memory();const count=$('#memoryCount');if(count)count.textContent=`${existing.length} saved interactions`;
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('nav button').forEach(x=>x.classList.remove('active'));b.classList.add('active');['live','memory','tasks','settings'].forEach(id=>$('#'+id).classList.toggle('hidden',id!==b.dataset.tab));if(b.dataset.tab==='memory')renderMemory();if(micEnabled)setTimeout(()=>window.forceEaraListening?.(),80)});

if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
window.askAI=askAI;window.startMedia=startMedia;window.getEaraStream=()=>stream;window.isEaraMicEnabled=()=>micEnabled;window.getEaraVoice=()=>localStorage.getItem(VOICEKEY)||'asteria';window.isEaraScreenSharing=()=>screenSharing;
setTimeout(()=>startMedia(true).then(ok=>{if(!ok){$('#permissionBtn').classList.remove('hidden');setState('Tap Enable Camera + Mic once.');badge('Ready')}else setTimeout(()=>window.forceEaraListening?.(),120)}),120);
