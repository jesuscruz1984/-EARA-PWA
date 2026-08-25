// EARA v31 field-visit memory: continuous foreground audio transcription + recall.
(()=>{
  const KEY='earaVisitSessionsV1',MEMKEY='earaMemoryV2',PERSONAKEY='earaPersona';
  const BACKEND='https://eara-pwa.jesuscruz1984.workers.dev';
  const MAX_SESSIONS=10,MAX_CHARS=90000,RECENT_MS=4*60*60*1000,CHUNK_MS=20000;
  const $=s=>document.querySelector(s);
  let active=false,current=null,wrapped=false,recorder=null,chunkTimer=null,restartTimer=null,pending=Promise.resolve(),stopping=false;

  function load(){try{return JSON.parse(localStorage.getItem(KEY)||'[]')}catch(_){return []}}
  function save(arr){localStorage.setItem(KEY,JSON.stringify(arr.slice(-MAX_SESSIONS)))}
  function persona(){return localStorage.getItem(PERSONAKEY)||'helpful'}
  function mem(){try{return JSON.parse(localStorage.getItem(MEMKEY)||'[]')}catch(_){return []}}
  function saveMem(arr){localStorage.setItem(MEMKEY,JSON.stringify(arr.slice(-500)));const c=$('#memoryCount');if(c)c.textContent=`${Math.min(arr.length,500)} saved interactions`}
  function addMem(entry){const a=mem();a.push({...entry,ts:new Date().toISOString()});saveMem(a)}
  function state(t){const e=$('#state');if(e)e.textContent=t}
  function badge(t){const e=$('#badgeText');if(e)e.textContent=t}
  function chip(t){const e=$('#ai');if(e)e.textContent=t}
  function setReply(text,speech=''){const r=$('#reply');if(r)r.textContent=String(text||'');window.__earaLastReply=String(text||'');window.__earaLastSpeech=String(speech||text||'');$('#copyReply')?.removeAttribute('disabled');$('#speak')?.removeAttribute('disabled')}
  function nowSession(){return load().find(x=>x.active)||null}
  function latestSession(){const a=load();return a[a.length-1]||null}
  function persist(){if(!current)return;const a=load(),i=a.findIndex(x=>x.id===current.id);if(i>=0)a[i]=current;else a.push(current);save(a)}
  function updateUi(){const b=$('#visitBtn'),s=$('#visitStatus');if(b){b.textContent=active?'Stop Visit Memory':'Start Visit Memory';b.classList.toggle('green',active)}if(s){const mins=current?Math.max(0,Math.round((Date.now()-current.startedAt)/60000)):0,chars=current?.transcript?.length||0;s.textContent=active?`Visit Memory ON · ${mins} min · ${chars.toLocaleString()} transcript chars`:'Visit Memory OFF'}}
  function appendText(text){if(!current)return;const clean=String(text||'').trim();if(!clean)return;const stamp=new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});current.transcript=((current.transcript||'')+`\n[${stamp}] ${clean}`).slice(-MAX_CHARS);current.updatedAt=Date.now();persist();updateUi()}
  function mimeType(){const opts=['audio/mp4','audio/webm;codecs=opus','audio/webm'];for(const t of opts)if(window.MediaRecorder?.isTypeSupported?.(t))return t;return ''}
  async function transcribeBlob(blob){if(!blob||blob.size<500)return;const fd=new FormData();fd.append('audio',blob,`visit.${blob.type.includes('mp4')?'m4a':'webm'}`);const r=await fetch(BACKEND+'/transcribe',{method:'POST',body:fd,cache:'no-store'});const raw=await r.text();if(!r.ok)throw new Error(raw||`HTTP ${r.status}`);const j=JSON.parse(raw);appendText(j.text||'')}
  function clearTimers(){clearTimeout(chunkTimer);clearTimeout(restartTimer);chunkTimer=restartTimer=null}
  function beginChunk(){
    if(!active||stopping)return;clearTimers();const stream=window.getEaraStream?.(),track=stream?.getAudioTracks?.()?.[0];if(!track||track.enabled===false){state('Visit Memory ON — waiting for microphone…');restartTimer=setTimeout(beginChunk,1000);return}
    try{
      const clone=new MediaStream([track.clone()]),type=mimeType();recorder=type?new MediaRecorder(clone,{mimeType:type}):new MediaRecorder(clone);const chunks=[];
      recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};
      recorder.onerror=()=>{try{clone.getTracks().forEach(t=>t.stop())}catch(_){};if(active)restartTimer=setTimeout(beginChunk,700)};
      recorder.onstop=()=>{try{clone.getTracks().forEach(t=>t.stop())}catch(_){};const blob=new Blob(chunks,{type:recorder?.mimeType||type||'audio/webm'});pending=pending.then(()=>transcribeBlob(blob)).catch(()=>{}).finally(()=>{if(active&&!stopping)restartTimer=setTimeout(beginChunk,120)});recorder=null};
      recorder.start();chunkTimer=setTimeout(()=>{try{if(recorder?.state==='recording')recorder.stop()}catch(_){}},CHUNK_MS);
      state('Visit Memory ON — listening and taking notes.');
    }catch(_){restartTimer=setTimeout(beginChunk,1000)}
  }
  function start(){
    if(!window.MediaRecorder){const msg='This browser cannot run continuous Visit Memory audio capture.';setReply(msg);window.say?.(msg);return}
    const existing=nowSession();current=existing||{id:'visit-'+Date.now(),active:true,startedAt:Date.now(),updatedAt:Date.now(),transcript:'',summary:''};current.active=true;active=true;stopping=false;persist();updateUi();state('Visit Memory ON — listening and taking notes.');badge('Visit Memory ON');beginChunk();
  }
  async function summarize(session){const transcript=String(session?.transcript||'').trim();if(!transcript)return '';const prompt=`You are EARA reviewing a customer security-system site visit. Extract only facts actually supported by the transcript. Give a concise field-estimate recap with: total cameras requested if determinable; every camera location mentioned; indoor/outdoor; special views or concerns; access control/intercom/network requests; customer preferences; unresolved questions; and follow-up items. If a count is uncertain, say so.\n\nFIELD VISIT TRANSCRIPT:\n${transcript.slice(-70000)}`;try{const r=await fetch(BACKEND+'/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:prompt,memory:'',memoryMode:'deep',personality:persona(),visionActive:false,source:'visit memory'}),cache:'no-store'}),raw=await r.text();if(!r.ok)throw new Error(raw);return String(JSON.parse(raw).text||'').trim()}catch(_){return ''}}
  async function stop(){
    if(!current){active=false;updateUi();return}active=false;stopping=true;clearTimers();try{if(recorder?.state==='recording')recorder.stop()}catch(_){};state('Visit ended — finishing transcript…');badge('Saving Visit');await pending;await new Promise(r=>setTimeout(r,350));await pending;current.active=false;current.endedAt=Date.now();persist();updateUi();const summary=await summarize(current);current.summary=summary;persist();const dur=Math.max(1,Math.round((current.endedAt-current.startedAt)/60000));addMem({user:`Field visit memory saved (${dur} min)`,assistant:summary||`Saved field-visit transcript (${String(current.transcript||'').length.toLocaleString()} characters). Ask EARA questions about this visit.`,persona:persona(),visit:true,visitId:current.id});setReply(summary||'Visit transcript saved. You can now ask me questions about what was discussed.');state('Visit saved. Ask EARA what the customer requested.');badge('Visit Saved');chip('VISIT MEMORY');if(summary)window.say?.('I saved the customer visit and organized the estimate notes. You can ask me questions about it now.');stopping=false
  }
  function sessionForRecall(){const s=active&&current?current:latestSession();if(!s)return null;if(active)return s;const end=s.endedAt||s.updatedAt||s.startedAt;return Date.now()-end<RECENT_MS?s:null}
  function isControl(q){return /\b(start|begin|turn on|enable)\b[\s\S]{0,20}\b(visit|estimate|customer|meeting)\s*(?:memory|notes|mode)?\b/i.test(q)||/\b(stop|end|finish|turn off|disable)\b[\s\S]{0,20}\b(visit|estimate|customer|meeting)\s*(?:memory|notes|mode)?\b/i.test(q)}
  function wantsStart(q){return /\b(start|begin|turn on|enable)\b[\s\S]{0,20}\b(visit|estimate|customer|meeting)\s*(?:memory|notes|mode)?\b/i.test(q)}
  function obviousOtherTask(q){return /\b(look at this|take (?:a )?(?:picture|photo)|camera button|saved picture|uploaded picture|search (?:the )?web|look up online|weather|timer|remind me|read this (?:paper|document))\b/i.test(q)}
  async function answerFromVisit(q,session){const transcript=String(session.transcript||'');const prompt=`Answer the user's question using the field-visit transcript below as the primary source. Be precise about counts and locations. Do not invent details. If the transcript is unclear or conflicting, say that. If the question is unrelated to the visit, answer normally and ignore the transcript.\n\nUSER QUESTION: ${q}\n\nFIELD VISIT TRANSCRIPT:\n${transcript.slice(-70000)}`;state('Reviewing customer visit…');badge('Reading Visit');chip('VISIT MEMORY');const r=await fetch(BACKEND+'/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:prompt,memory:'',memoryMode:'deep',personality:persona(),visionActive:false,source:'visit memory'}),cache:'no-store'}),raw=await r.text();if(!r.ok)throw new Error(raw||`HTTP ${r.status}`);const j=JSON.parse(raw),answer=String(j.text||'No answer').trim(),speech=j.speech||answer;setReply(answer,speech);addMem({user:q,assistant:answer,persona:persona(),visit:true,visitId:session.id});state(active?'Visit Memory ON — continuing to listen.':'Visit saved — ready for questions.');badge(active?'Visit Memory ON':'Eara Ready');window.say?.(speech);return answer}
  function installUi(){const controls=$('#mediaControls'),pad=controls?.parentElement;if(pad&&!$('#visitBtn')){const b=document.createElement('button');b.id='visitBtn';b.type='button';b.style.cssText='width:100%;margin-top:9px';b.textContent='Start Visit Memory';b.onclick=e=>{e.preventDefault();active?stop():start()};pad.insertBefore(b,$('#state')||null);const s=document.createElement('div');s.id='visitStatus';s.className='small';s.style.marginTop='6px';pad.insertBefore(s,$('#state')||null)}const core=$('#settings .pad');if(core&&!$('#visitHelp')){const d=document.createElement('div');d.id='visitHelp';d.className='small';d.style.marginTop='12px';d.textContent='Visit Memory: start it before a customer estimate. While the PWA remains open and the microphone is available, EARA records short audio segments, transcribes them, then discards the raw audio. The local transcript is used for later questions and an estimate recap. iPhone may suspend capture if the PWA is locked or fully backgrounded. Recording laws vary, so get any consent required where you are.';core.appendChild(d)}updateUi()}
  function wrapAsk(){if(wrapped||typeof window.askAI!=='function')return;const prev=window.askAI;window.askAI=async q=>{const text=String(q||'').trim();if(!text)return prev(q);if(isControl(text)){if(wantsStart(text)){start();const msg='Visit Memory is on. I will keep taking conversation notes while the app stays open.';setReply(msg);window.say?.(msg);return msg}else{await stop();return window.__earaLastReply||'Visit saved.'}}const s=sessionForRecall();if(s&&!obviousOtherTask(text)){try{return await answerFromVisit(text,s)}catch(_){return prev(q)}}return prev(q)};wrapped=true}
  window.addEventListener('eara-media-ready',()=>{installUi();wrapAsk();if(active&&!recorder)beginChunk()});
  window.addEventListener('eara-mic-enabled',()=>{if(active&&!recorder)beginChunk()});
  window.addEventListener('eara-mic-disabled',()=>{if(active){clearTimers();try{if(recorder?.state==='recording')recorder.stop()}catch(_){}}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){installUi();wrapAsk();if(active&&!recorder)beginChunk()}else if(active){state('Visit Memory may pause while EARA is in the background.')}});
  const resume=nowSession();if(resume){current=resume;active=true}
  setTimeout(()=>{installUi();wrapAsk();if(active)beginChunk()},120);
})();
