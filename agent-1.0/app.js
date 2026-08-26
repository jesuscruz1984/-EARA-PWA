const BACKEND='https://eara-pwa.jesuscruz1984.workers.dev';
const STORE='agent10ThreadsV2';
const CURRENT='agent10CurrentThreadV2';
const VOICE='agent10VoiceOn';
const $=s=>document.querySelector(s);

let threads=loadThreads();
let currentId=localStorage.getItem(CURRENT)||'';
let selectedImage='';
let selectedImageName='';
let selectedFile=null;
let busy=false;
let voiceOn=localStorage.getItem(VOICE)==='1';
let cameraStream=null;
let webForce=false;
let recognition=null;
let lastGeneratedImage='';

function uid(){return 't_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8)}
function loadThreads(){try{const x=JSON.parse(localStorage.getItem(STORE)||'[]');return Array.isArray(x)?x:[]}catch(_){return []}}
function persistableThreads(){return threads.slice(0,40).map(t=>({...t,messages:(t.messages||[]).map(m=>({...m,image:'',images:[]}))}))}
function saveThreads(){try{localStorage.setItem(STORE,JSON.stringify(persistableThreads()))}catch(_){}}
function current(){return threads.find(t=>t.id===currentId)||null}
function ensureThread(){let t=current();if(t)return t;t={id:uid(),title:'New chat',created:Date.now(),updated:Date.now(),messages:[]};threads.unshift(t);currentId=t.id;localStorage.setItem(CURRENT,currentId);saveThreads();return t}
function setStatus(text,kind='ok'){const e=$('#status');if(!e)return;e.textContent=text;e.className='statusText '+kind}
function scrollBottom(){requestAnimationFrame(()=>{const c=$('#chat');if(c)c.scrollTop=c.scrollHeight})}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function renderText(text){
  let s=esc(text||'');const blocks=[];
  s=s.replace(/```([\s\S]*?)```/g,(_,code)=>{const n=blocks.length;blocks.push(`<pre><code>${code.trim()}</code></pre>`);return `@@CODE${n}@@`});
  s=s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
  s=s.replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1" target="_blank" rel="noopener">$1</a>');
  s=s.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
  const lines=s.split(/\r?\n/);let out='',list='';
  const closeList=()=>{if(list){out+=list+'</ul>';list=''}};
  for(const line of lines){const m=line.match(/^\s*[-•]\s+(.+)/);if(m){if(!list)list='<ul>';list+=`<li>${m[1]}</li>`;continue}closeList();if(/^@@CODE\d+@@$/.test(line.trim()))out+=line.trim();else if(line.trim())out+=`<p>${line}</p>`;else out+='<br>'}
  closeList();return out.replace(/@@CODE(\d+)@@/g,(_,n)=>blocks[Number(n)]||'');
}
function toolLabel(t){return ({web:'Web',python:'Python',image_generation:'Image generation',file_search:'File search',computer:'Computer'}[t]||String(t||''))}
function messageMeta(m){
  if(m.role!=='assistant')return '';
  const badges=[];const r=String(m.route||'');
  if(r==='sol')badges.push('GPT-5.6 Sol');else if(r==='terra')badges.push('GPT-5.6 Terra');else if(r.includes('fallback'))badges.push('Backup AI');
  for(const t of m.toolsUsed||[])badges.push(toolLabel(t));
  return badges.map(x=>`<span class="toolBadge">${esc(x)}</span>`).join('');
}
function renderThreads(){
  const box=$('#threads');box.innerHTML='';
  [...threads].sort((a,b)=>(b.updated||0)-(a.updated||0)).forEach(t=>{
    const row=document.createElement('div');row.className='thread'+(t.id===currentId?' active':'');
    row.innerHTML=`<div class="threadTitle">${esc(t.title||'New chat')}</div><button class="threadDelete" title="Delete">×</button>`;
    row.querySelector('.threadTitle').onclick=()=>{currentId=t.id;localStorage.setItem(CURRENT,currentId);renderAll();closeDrawer()};
    row.querySelector('.threadDelete').onclick=e=>{e.stopPropagation();threads=threads.filter(x=>x.id!==t.id);if(currentId===t.id)currentId=threads[0]?.id||'';localStorage.setItem(CURRENT,currentId);saveThreads();renderAll()};
    box.appendChild(row);
  });
}
function renderWelcome(){return `<div class="welcome"><div class="bigOrb"></div><h1>How can I help?</h1><p>Agent 1.0 can reason, search the web, run Python, read files, understand images, generate images, use voice, and automatically choose tools for the job.</p><div class="suggestions"><button class="suggest" data-prompt="Build a simple working web app for tracking invoices. Create the files and test the logic.">Build an app</button><button class="suggest" data-prompt="Search the web for the most important AI news today and summarize it with sources.">Research current information</button><button class="suggest" data-prompt="Create an image of a futuristic AI assistant interface.">Generate an image</button><button class="suggest" data-prompt="Help me analyze a spreadsheet. I will attach the file.">Analyze a file</button></div></div>`}
function renderMessages(){
  const t=ensureThread(),box=$('#messages');
  if(!t.messages.length){box.innerHTML=renderWelcome();box.querySelectorAll('[data-prompt]').forEach(b=>b.onclick=()=>{const q=b.dataset.prompt;$('#prompt').value=q;autoSize();$('#prompt').focus()});return}
  box.innerHTML=t.messages.map(m=>{
    const img=m.image?`<img class="msgImage" src="${m.image}" alt="attached image">`:'';
    const file=m.fileName?`<div class="fileChip">📎 <span>${esc(m.fileName)}</span></div>`:'';
    const generated=(m.images||[]).length?`<div class="genImages">${m.images.map((src,i)=>`<img src="${src}" alt="Generated image ${i+1}">`).join('')}</div>`:'';
    if(m.role==='user')return `<div class="msg user"><div class="bubble">${img}${file}<div class="content">${renderText(m.text)}</div></div></div>`;
    return `<div class="msg assistant"><div class="avatar"></div><div class="bubble"><div class="content">${renderText(m.text)}</div>${generated}${messageMeta(m)?`<div class="meta">${messageMeta(m)}</div>`:''}</div></div>`;
  }).join('');scrollBottom();
}
function renderAll(){ensureThread();renderThreads();renderMessages();updateVoiceButton()}
function addMessage(m){const t=ensureThread();t.messages.push({...m,ts:Date.now()});t.updated=Date.now();if(t.title==='New chat'&&m.role==='user')t.title=makeTitle(m.text);saveThreads();renderThreads();renderMessages()}
function makeTitle(s){let t=String(s||'').replace(/\s+/g,' ').trim();if(t.length>42)t=t.slice(0,42).replace(/\s+\S*$/,'')+'…';return t||'New chat'}
function conversationMemory(){const t=ensureThread();return t.messages.slice(-32).map(m=>`${m.role==='user'?'User':'Agent 1.0'}: ${String(m.text||'').slice(0,2000)}`).join('\n\n').slice(-22000)}
function totalMemoryCount(){return ensureThread().messages.length}
function imageEditFollowup(text){return /\b(make it|change it|edit it|modify it|make that|change that|edit that|more realistic|less realistic|different color|add |remove |image again|picture again)\b/i.test(String(text||''))}

async function fetchChat(text,image,file){
  const effectiveImage=image||(!file&&lastGeneratedImage&&imageEditFollowup(text)?lastGeneratedImage:'');
  const body={text,image:effectiveImage||null,file:file||null,memory:conversationMemory(),memoryCount:totalMemoryCount(),forceWeb:webForce,agentMode:true};
  let last=null;
  for(let attempt=0;attempt<2;attempt++){
    try{
      const r=await fetch(BACKEND+'/agent-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
      const raw=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${raw}`);const j=JSON.parse(raw);if(j?.text||j?.images?.length)return j;throw new Error('Empty AI response');
    }catch(e){last=e;if(attempt===0)await new Promise(r=>setTimeout(r,350))}
  }
  throw last||new Error('Request failed');
}
function showThinking(){const box=$('#messages');const d=document.createElement('div');d.className='msg assistant';d.id='thinking';d.innerHTML='<div class="avatar"></div><div class="bubble"><div class="thinking"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div></div>';box.appendChild(d);scrollBottom()}
function removeThinking(){$('#thinking')?.remove()}
function friendlyError(e){const s=String(e?.message||e||'');if(/413|too large/i.test(s))return 'That file is too large for this Agent 1.0 test build. Try a smaller file.';if(/429|capacity|temporarily busy/i.test(s))return 'The AI is busy right now. I tried the backup route too. Please try again in a moment.';if(/401|403/.test(s))return 'Agent 1.0 could not authenticate with the AI service.';return 'I had a connection problem. Please try that again.'}

async function send(){
  if(busy)return;const input=$('#prompt'),text=input.value.trim();if(!text&&!selectedImage&&!selectedFile)return;
  busy=true;setStatus('Agent working…','busy');$('#sendBtn').disabled=true;
  const image=selectedImage||'';const file=selectedFile;const displayText=text||(file?'Analyze this file.':'What do you see in this image?');
  addMessage({role:'user',text:displayText,image,fileName:file?.filename||''});input.value='';autoSize();clearImage(false);clearFile(false);hideAttachments();showThinking();
  try{
    const j=await fetchChat(displayText,image,file);removeThinking();
    if(j?.images?.length)lastGeneratedImage=j.images[0];
    addMessage({role:'assistant',text:j.text||'Done.',route:j.route||'',model:j.model||'',toolsUsed:j.toolsUsed||[],images:j.images||[]});
    const tools=(j.toolsUsed||[]).map(toolLabel);setStatus(tools.length?`Used: ${tools.join(' • ')}`:'Ready','ok');if(voiceOn)speak(j.speech||j.text);
  }catch(e){removeThinking();const msg=friendlyError(e);addMessage({role:'assistant',text:msg,route:'error'});setStatus('Try again','error')}
  finally{busy=false;webForce=false;$('#sendBtn').disabled=false;input.focus();updateSend()}
}

function clearImage(render=true){selectedImage='';selectedImageName='';$('#preview').classList.remove('show');$('#previewImg').removeAttribute('src');if(render)updateSend()}
function selectImage(dataUrl,name='Image'){selectedImage=dataUrl;selectedImageName=name;selectedFile=null;$('#filePreview').classList.remove('show');$('#previewImg').src=dataUrl;$('#preview').classList.add('show');updateSend()}
function clearFile(render=true){selectedFile=null;$('#filePreview').classList.remove('show');$('#filePreviewName').textContent='';if(render)updateSend()}
function selectFile(dataUrl,file){selectedFile={filename:file.name||'attachment',mime:file.type||'application/octet-stream',data:dataUrl,size:file.size||0};clearImage(false);$('#filePreviewName').textContent='📎 '+selectedFile.filename;$('#filePreview').classList.add('show');updateSend()}
function fileToDataUrl(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=reject;reader.readAsDataURL(file)})}
function loadImage(src){return new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=src})}
async function handleFile(file){
  if(!file)return;setStatus('Loading file…','busy');
  try{
    if(/^image\//i.test(file.type)){
      const raw=await fileToDataUrl(file),img=await loadImage(raw),max=1800,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.naturalWidth*scale));c.height=Math.max(1,Math.round(img.naturalHeight*scale));c.getContext('2d').drawImage(img,0,0,c.width,c.height);selectImage(c.toDataURL('image/jpeg',.86),file.name);setStatus('Image ready','ok');return;
    }
    if(file.size>6_000_000)throw new Error('File too large');
    selectFile(await fileToDataUrl(file),file);setStatus('File ready','ok');
  }catch(e){setStatus(/too large/i.test(String(e))?'File too large — use under 6 MB':'Could not load file','error')}
}

function toggleAttachments(){if(busy)return;$('#attachments').classList.toggle('show')}
function hideAttachments(){$('#attachments').classList.remove('show')}
function openDrawer(){$('#sidebar').classList.add('open');$('#drawerShade').classList.add('show')}
function closeDrawer(){$('#sidebar').classList.remove('open');$('#drawerShade').classList.remove('show')}
function autoSize(){const e=$('#prompt');e.style.height='auto';e.style.height=Math.min(e.scrollHeight,150)+'px';updateSend()}
function updateSend(){$('#sendBtn').disabled=busy||(!$('#prompt').value.trim()&&!selectedImage&&!selectedFile)}

function updateVoiceButton(){const b=$('#voiceToggle');b.classList.toggle('on',voiceOn);b.title=voiceOn?'Speak replies: on':'Speak replies: off'}
function toggleVoice(){voiceOn=!voiceOn;localStorage.setItem(VOICE,voiceOn?'1':'0');updateVoiceButton();setStatus(voiceOn?'Voice replies on':'Voice replies off','ok')}
function cleanSpeech(text){return String(text||'').replace(/https?:\/\/\S+/g,'').replace(/Sources?\s*\/?\s*links?:[\s\S]*$/i,'').replace(/[\*_`#>|]+/g,' ').replace(/\s+/g,' ').trim().slice(0,500)}
async function speak(text){const msg=cleanSpeech(text);if(!msg)return;try{const r=await fetch(BACKEND+'/tts?raw=1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:msg,speaker:'asteria'}),cache:'no-store'});if(!r.ok)throw new Error('tts');const blob=await r.blob(),url=URL.createObjectURL(blob),a=new Audio(url);a.onended=()=>URL.revokeObjectURL(url);await a.play()}catch(_){try{speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(msg);u.lang='en-US';speechSynthesis.speak(u)}catch(__){}}}
function setupDictation(){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){$('#dictateBtn').style.display='none';return}recognition=new SR();recognition.continuous=false;recognition.interimResults=false;recognition.lang='en-US';recognition.onstart=()=>{setStatus('Listening…','busy');$('#dictateBtn').classList.add('on')};recognition.onend=()=>{$('#dictateBtn').classList.remove('on');if(!busy)setStatus('Ready','ok')};recognition.onresult=e=>{const t=String(e.results?.[0]?.[0]?.transcript||'').trim();if(t){$('#prompt').value=($('#prompt').value.trim()?$('#prompt').value.trim()+' ':'')+t;autoSize();$('#prompt').focus()}};recognition.onerror=()=>setStatus('Voice input unavailable','error')}
function dictate(){try{recognition?.start()}catch(_){}}

async function openCamera(){hideAttachments();try{cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:960}},audio:false});$('#cameraVideo').srcObject=cameraStream;$('#cameraModal').classList.add('show');await $('#cameraVideo').play()}catch(_){setStatus('Camera permission unavailable','error')}}
function stopCamera(){if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null}$('#cameraVideo').srcObject=null;$('#cameraModal').classList.remove('show')}
function captureCamera(){const v=$('#cameraVideo'),c=$('#cameraCanvas');if(!v.videoWidth)return;const scale=Math.min(1,1800/v.videoWidth);c.width=Math.round(v.videoWidth*scale);c.height=Math.round(v.videoHeight*scale);c.getContext('2d').drawImage(v,0,0,c.width,c.height);selectImage(c.toDataURL('image/jpeg',.86),'Camera');stopCamera();setStatus('Camera image ready','ok');$('#prompt').focus()}

async function loadCapabilities(){
  const live=$('#liveTools'),connect=$('#connectTools');
  live.innerHTML='<div class="toolCard"><div class="toolName">Loading tools…</div></div>';connect.innerHTML='';
  try{
    const r=await fetch(BACKEND+'/agent-capabilities',{cache:'no-store'}),j=await r.json();if(!r.ok)throw new Error('capabilities');
    live.innerHTML=(j.live||[]).map(x=>`<div class="toolCard"><div class="toolName">${esc(x.name)}</div><div class="toolState">● Live</div></div>`).join('');
    connect.innerHTML=(j.connect||[]).map(x=>`<div class="toolCard"><div class="toolName">${esc(x.name)}</div><div class="toolState connect">○ Connection required</div><div class="toolReason">${esc(x.reason||'Secure authorization required.')}</div></div>`).join('');
  }catch(_){live.innerHTML='<div class="toolCard"><div class="toolName">Could not load tool status</div><div class="toolState connect">Try again later</div></div>'}
}
function openTools(){$('#toolsModal').classList.add('show');loadCapabilities()}
function closeTools(){$('#toolsModal').classList.remove('show')}

function newChat(){const t={id:uid(),title:'New chat',created:Date.now(),updated:Date.now(),messages:[]};threads.unshift(t);currentId=t.id;localStorage.setItem(CURRENT,currentId);saveThreads();clearImage(false);clearFile(false);lastGeneratedImage='';renderAll();closeDrawer();$('#prompt').focus();setStatus('Ready','ok')}
function clearCurrent(){const t=current();if(!t||!t.messages.length)return;if(!confirm('Clear this conversation?'))return;t.messages=[];t.title='New chat';t.updated=Date.now();saveThreads();lastGeneratedImage='';renderAll();setStatus('Conversation cleared','ok')}

$('#sendBtn').onclick=send;
$('#prompt').addEventListener('input',autoSize);
$('#prompt').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}});
$('#addBtn').onclick=toggleAttachments;
$('#uploadBtn').onclick=()=>{$('#fileInput').click();hideAttachments()};
$('#fileInput').onchange=e=>{handleFile(e.target.files?.[0]);e.target.value=''};
$('#cameraBtn').onclick=openCamera;$('#closeCamera').onclick=stopCamera;$('#useCamera').onclick=captureCamera;
$('#removeImage').onclick=()=>clearImage();$('#removeFile').onclick=()=>clearFile();
$('#webHintBtn').onclick=()=>{webForce=true;hideAttachments();setStatus('Web search armed','ok');const p=$('#prompt');if(!p.value.trim())p.placeholder='Ask something to search online…';p.focus()};
$('#imageHintBtn').onclick=()=>{hideAttachments();const p=$('#prompt');if(!p.value.trim())p.value='Create an image of ';autoSize();p.focus()};
$('#voiceToggle').onclick=toggleVoice;$('#dictateBtn').onclick=dictate;$('#clearBtn').onclick=clearCurrent;$('#newChat').onclick=newChat;
$('#menuBtn').onclick=openDrawer;$('#drawerShade').onclick=closeDrawer;
$('#toolsBtn').onclick=openTools;$('#toolsClose').onclick=closeTools;$('#toolsModal').addEventListener('click',e=>{if(e.target===$('#toolsModal'))closeTools()});
document.addEventListener('click',e=>{if(!$('#attachments').contains(e.target)&&e.target!==$('#addBtn'))hideAttachments()});
window.addEventListener('beforeunload',stopCamera);
setupDictation();renderAll();updateSend();setStatus('Ready','ok');$('#prompt').focus();
if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
