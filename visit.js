// EARA v43 field-visit memory: share the held WebView microphone safely.
(()=>{
  const SESSION_KEY='earaVisitSessionsV1';
  const MEMKEY='earaMemoryV2';
  const PERSONAKEY='earaPersona';
  const AUDIO_DB='earaVisitAudioV1';
  const AUDIO_STORE='segments';
  const BACKEND='https://eara-pwa.jesuscruz1984.workers.dev';
  const MAX_SESSIONS=10;
  const MAX_TRANSCRIPT_CHARS=120000;
  const RECENT_MS=6*60*60*1000;
  const CHUNK_MS=20000;
  const $=s=>document.querySelector(s);

  let active=false,current=null,wrapped=false,recorder=null,chunkTimer=null,restartTimer=null;
  let pending=Promise.resolve(),stopping=false,stopWait=Promise.resolve(),resolveStopWait=null;
  let playbackToken=0;

  function loadSessions(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'[]')}catch(_){return []}}
  function saveSessions(arr){localStorage.setItem(SESSION_KEY,JSON.stringify(arr.slice(-MAX_SESSIONS)))}
  function persona(){return localStorage.getItem(PERSONAKEY)||'helpful'}
  function memories(){try{return JSON.parse(localStorage.getItem(MEMKEY)||'[]')}catch(_){return []}}
  function saveMem(arr){localStorage.setItem(MEMKEY,JSON.stringify(arr.slice(-500)));const c=$('#memoryCount');if(c)c.textContent=`${Math.min(arr.length,500)} saved interactions`}
  function addMem(entry){const a=memories();a.push({...entry,ts:new Date().toISOString()});saveMem(a)}
  function state(t){const e=$('#state');if(e)e.textContent=t}
  function badge(t){const e=$('#badgeText');if(e)e.textContent=t;const s=$('#busySpinner');if(s)s.classList.toggle('hidden',!/record|saving|transcrib|analyz|reading|processing/i.test(String(t||'')))}
  function chip(t){const e=$('#ai');if(e)e.textContent=t}
  function setReply(text,speech=''){const r=$('#reply');if(r)r.textContent=String(text||'');window.__earaLastReply=String(text||'');window.__earaLastSpeech=String(speech||text||'');$('#copyReply')?.removeAttribute('disabled');$('#speak')?.removeAttribute('disabled')}
  function nowSession(){return loadSessions().find(x=>x.active)||null}
  function latestSession(){const a=loadSessions();return a[a.length-1]||null}
  function persistSession(s=current){if(!s)return;const a=loadSessions(),i=a.findIndex(x=>x.id===s.id);if(i>=0)a[i]=s;else a.push(s);saveSessions(a)}
  function getSession(id){return loadSessions().find(x=>x.id===id)||null}
  function setSession(s){if(!s)return;persistSession(s);if(current?.id===s.id)current=s}

  function openAudioDb(){return new Promise((resolve,reject)=>{
    const req=indexedDB.open(AUDIO_DB,1);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(AUDIO_STORE)){
        const st=db.createObjectStore(AUDIO_STORE,{keyPath:'id',autoIncrement:true});
        st.createIndex('visitId','visitId');
        st.createIndex('ts','ts');
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  })}
  async function saveAudioSegment(rec){const db=await openAudioDb();return new Promise((resolve,reject)=>{const req=db.transaction(AUDIO_STORE,'readwrite').objectStore(AUDIO_STORE).add(rec);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
  async function updateAudioSegment(id,patch){const db=await openAudioDb();return new Promise((resolve,reject)=>{const tx=db.transaction(AUDIO_STORE,'readwrite'),st=tx.objectStore(AUDIO_STORE),req=st.get(Number(id));req.onsuccess=()=>{if(req.result)st.put({...req.result,...patch,updatedAt:Date.now()})};tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error)})}
  async function audioSegments(visitId){const db=await openAudioDb();return new Promise((resolve,reject)=>{const idx=db.transaction(AUDIO_STORE,'readonly').objectStore(AUDIO_STORE).index('visitId'),req=idx.getAll(IDBKeyRange.only(visitId));req.onsuccess=()=>resolve((req.result||[]).sort((a,b)=>(a.seq||0)-(b.seq||0)));req.onerror=()=>reject(req.error)})}

  function appendTranscript(visitId,text,segmentId){
    const clean=String(text||'').trim();if(!clean)return;
    const s=getSession(visitId)||current;if(!s||s.id!==visitId)return;
    const stamp=new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
    s.transcript=((s.transcript||'')+`\n[${stamp}] ${clean}`).slice(-MAX_TRANSCRIPT_CHARS);
    s.transcribedSegments=(s.transcribedSegments||0)+1;
    s.updatedAt=Date.now();
    setSession(s);
    if(segmentId)updateAudioSegment(segmentId,{status:'transcribed',transcript:clean,error:''}).catch(()=>{});
    updateUi();renderVisitPanel();
  }

  function mimeType(){const opts=['audio/mp4','audio/webm;codecs=opus','audio/webm'];for(const t of opts)if(window.MediaRecorder?.isTypeSupported?.(t))return t;return ''}
  function extensionFor(type){return String(type||'').includes('mp4')?'m4a':'webm'}
  async function transcribeStoredSegment(seg,retry=false){
    if(!seg?.blob||seg.blob.size<500)return '';
    const fd=new FormData();fd.append('audio',seg.blob,`visit-${seg.seq}.${extensionFor(seg.mime||seg.blob.type)}`);
    let last='';
    for(let attempt=0;attempt<(retry?2:1);attempt++){
      try{
        const r=await fetch(BACKEND+'/transcribe',{method:'POST',body:fd,cache:'no-store'}),raw=await r.text();
        if(!r.ok)throw new Error(raw||`HTTP ${r.status}`);
        const text=String(JSON.parse(raw).text||'').trim();
        if(text){appendTranscript(seg.visitId,text,seg.id);return text}
        last='No transcript returned';
      }catch(e){last=String(e?.message||e);if(attempt===0&&retry)await new Promise(r=>setTimeout(r,350))}
    }
    await updateAudioSegment(seg.id,{status:'transcription-error',error:last}).catch(()=>{});
    const s=getSession(seg.visitId);if(s){s.transcriptionErrors=(s.transcriptionErrors||0)+1;s.updatedAt=Date.now();setSession(s);updateUi();renderVisitPanel()}
    return '';
  }

  async function processBlob(blob,visitId,seq,mime){
    if(!blob||blob.size<500)return;
    const segId=await saveAudioSegment({visitId,seq,blob,mime:mime||blob.type||'audio/webm',size:blob.size,ts:Date.now(),status:'saved',transcript:'',error:''});
    const s=getSession(visitId);if(s){s.audioSegments=(s.audioSegments||0)+1;s.audioBytes=(s.audioBytes||0)+blob.size;s.updatedAt=Date.now();setSession(s);updateUi();renderVisitPanel()}
    const seg={id:segId,visitId,seq,blob,mime:mime||blob.type||'audio/webm'};
    await transcribeStoredSegment(seg,false);
  }

  function clearTimers(){clearTimeout(chunkTimer);clearTimeout(restartTimer);chunkTimer=restartTimer=null}
  function scheduleNext(ms=40){clearTimeout(restartTimer);if(active&&!stopping)restartTimer=setTimeout(beginChunk,ms)}
  function directMicTrack(){return window.getEaraStream?.()?.getAudioTracks?.()?.find(t=>t.readyState==='live'&&t.enabled!==false)||null}
  function nativeHandsFreeOwnsMic(){return !!window.EARANative&&!directMicTrack()}
  function pauseNativeVisit(){
    clearTimers();active=false;stopping=false;
    if(current){current.active=false;current.updatedAt=Date.now();current.pausedReason='android-native-hands-free';persistSession()}
    updateUi();renderVisitPanel();state('Listening for “Eara” — Android microphone ready.');badge('Eara Ready');chip('SMART AI');
    window.dispatchEvent(new CustomEvent('eara-visit-stopped'));
    setTimeout(()=>window.forceEaraListening?.(),80);
  }
  function beginChunk(){
    if(!active||stopping||recorder)return;
    clearTimeout(chunkTimer);
    const track=directMicTrack();
    if(!track){
      if(nativeHandsFreeOwnsMic()){pauseNativeVisit();return}
      state('Visit Memory ON — waiting for microphone…');scheduleNext(1400);return
    }
    const sessionId=current?.id;if(!sessionId)return;
    const seq=(current.nextSeq||1);current.nextSeq=seq+1;persistSession();
    try{
      const clone=new MediaStream([track.clone()]),type=mimeType();
      const options={};if(type)options.mimeType=type;options.audioBitsPerSecond=48000;
      const localRecorder=new MediaRecorder(clone,options);recorder=localRecorder;const chunks=[];
      stopWait=new Promise(res=>{resolveStopWait=res});
      localRecorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};
      localRecorder.onerror=()=>{try{clone.getTracks().forEach(t=>t.stop())}catch(_){};if(recorder===localRecorder)recorder=null;resolveStopWait?.();resolveStopWait=null;scheduleNext(700)};
      localRecorder.onstop=()=>{
        try{clone.getTracks().forEach(t=>t.stop())}catch(_){}
        const usedType=localRecorder.mimeType||type||'audio/webm';
        const blob=new Blob(chunks,{type:usedType});
        if(recorder===localRecorder)recorder=null;
        resolveStopWait?.();resolveStopWait=null;
        if(active&&!stopping)scheduleNext(35);
        pending=pending.then(()=>processBlob(blob,sessionId,seq,usedType)).catch(()=>{});
      };
      localRecorder.start();
      chunkTimer=setTimeout(()=>{try{if(localRecorder.state==='recording')localRecorder.stop()}catch(_){}},CHUNK_MS);
      state('Visit Memory ON — audio is being saved and transcribed.');badge('Recording Visit');chip('VISIT RECORDING');updateUi();
    }catch(e){if(recorder)recorder=null;resolveStopWait?.();resolveStopWait=null;state('Visit Memory ON — recorder reconnecting…');scheduleNext(900)}
  }

  function start(){
    if(!window.MediaRecorder){const msg='This browser cannot run Visit Memory audio recording.';setReply(msg);window.say?.(msg);return}
    if(nativeHandsFreeOwnsMic()){
      const msg='Android hands-free listening is using the microphone. EARA is ready for the wake word, but Visit Memory recording is paused in this build.';
      pauseNativeVisit();setReply(msg,msg);return
    }
    const existing=nowSession();
    current=existing||{id:'visit-'+Date.now(),active:true,startedAt:Date.now(),updatedAt:Date.now(),transcript:'',summary:'',audioSegments:0,audioBytes:0,transcribedSegments:0,transcriptionErrors:0,nextSeq:1};
    current.active=true;active=true;stopping=false;persistSession();window.dispatchEvent(new CustomEvent('eara-visit-started'));updateUi();renderVisitPanel();state('Visit Memory ON — audio is being saved and transcribed.');badge('Recording Visit');chip('VISIT RECORDING');beginChunk();
  }

  async function retryMissingTranscripts(session){
    const segs=await audioSegments(session.id);const missing=segs.filter(s=>!String(s.transcript||'').trim());
    if(!missing.length)return 0;
    state(`Retrying ${missing.length} saved audio segment${missing.length===1?'':'s'}…`);badge('Transcribing Saved Audio');
    let recovered=0;
    for(let i=0;i<missing.length;i++){
      state(`Transcribing saved audio ${i+1} of ${missing.length}…`);
      const text=await transcribeStoredSegment(missing[i],true);if(text)recovered++;
    }
    return recovered;
  }

  async function summarize(session){
    const refreshed=getSession(session.id)||session;
    const transcript=String(refreshed.transcript||'').trim();
    if(!transcript)return '';
    const prompt=`You are EARA reviewing a customer security-system site visit. Extract only facts supported by the transcript. Produce a practical estimate recap with: total cameras requested if determinable; each camera location; indoor/outdoor; special views or concerns; access control, intercom, Wi-Fi/network or recorder requirements; customer preferences; unresolved questions; and follow-up items. Preserve useful quantities and wording. If a count is uncertain or conflicting, say so.\n\nFIELD VISIT TRANSCRIPT:\n${transcript.slice(-100000)}`;
    try{
      const r=await fetch(BACKEND+'/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:prompt,memory:'',memoryMode:'deep',personality:persona(),visionActive:false,source:'visit memory'}),cache:'no-store'}),raw=await r.text();
      if(!r.ok)throw new Error(raw||`HTTP ${r.status}`);
      return String(JSON.parse(raw).text||'').trim();
    }catch(_){return ''}
  }

  async function analyzeVisit(session,manual=false){
    const before=getSession(session.id)||session;
    const segs=await audioSegments(before.id).catch(()=>[]);
    if(!segs.length){const msg='I do not have any saved audio for this visit yet.';setReply(msg,msg);state(msg);badge('No Visit Audio');return ''}
    await pending;
    let refreshed=getSession(before.id)||before;
    if(!String(refreshed.transcript||'').trim()||segs.some(s=>!String(s.transcript||'').trim()))await retryMissingTranscripts(refreshed);
    refreshed=getSession(before.id)||refreshed;
    if(!String(refreshed.transcript||'').trim()){
      const msg='The visit audio is saved, but transcription did not complete yet. Tap Analyze Visit again while you have internet.';
      setReply(msg,msg);state(msg);badge('Audio Saved');renderVisitPanel();return '';
    }
    state('Analyzing customer visit…');badge('Analyzing Visit');chip('VISIT ANALYSIS');
    const summary=await summarize(refreshed);
    refreshed=getSession(refreshed.id)||refreshed;refreshed.summary=summary;refreshed.analyzedAt=Date.now();persistSession(refreshed);if(current?.id===refreshed.id)current=refreshed;
    const dur=Math.max(1,Math.round(((refreshed.endedAt||Date.now())-refreshed.startedAt)/60000));
    addMem({user:`Customer visit analyzed (${dur} min, ${refreshed.audioSegments||segs.length} saved audio segments)`,assistant:summary||`Visit audio and transcript are saved. Ask EARA questions about this visit.`,persona:persona(),visit:true,visitId:refreshed.id,audioSaved:true});
    if(summary){setReply(summary,'I saved the audio, transcribed the visit, and organized the customer estimate notes.');state('Visit audio saved and analysis complete.');badge('Visit Analyzed');chip('VISIT MEMORY');if(!manual)window.say?.('I saved the audio, transcribed the visit, and organized the customer estimate notes.')}else{const msg='The audio and transcript are saved, but the AI summary failed. You can still ask questions from the transcript or tap Analyze Visit again.';setReply(msg,msg);state(msg);badge('Transcript Saved')}
    renderVisitPanel();return summary
  }

  async function stop(){
    if(!current){active=false;updateUi();return}
    active=false;stopping=true;clearTimers();
    try{if(recorder?.state==='recording')recorder.stop()}catch(_){}
    state('Visit ended — saving final audio…');badge('Saving Visit Audio');
    try{await stopWait}catch(_){}
    await pending;
    current=getSession(current.id)||current;current.active=false;current.endedAt=Date.now();current.updatedAt=Date.now();persistSession();updateUi();renderVisitPanel();
    await analyzeVisit(current,false);
    stopping=false;window.dispatchEvent(new CustomEvent('eara-visit-stopped'));
  }

  function sessionForRecall(){const s=active&&current?current:latestSession();if(!s)return null;if(active)return s;const end=s.endedAt||s.updatedAt||s.startedAt;return Date.now()-end<RECENT_MS?s:null}
  function isControl(q){return /\b(start|begin|turn on|enable)\b[\s\S]{0,25}\b(visit|estimate|customer|meeting)\s*(?:memory|recording|notes|mode)?\b/i.test(q)||/\b(stop|end|finish|turn off|disable)\b[\s\S]{0,25}\b(visit|estimate|customer|meeting)\s*(?:memory|recording|notes|mode)?\b/i.test(q)}
  function wantsStart(q){return /\b(start|begin|turn on|enable)\b[\s\S]{0,25}\b(visit|estimate|customer|meeting)\s*(?:memory|recording|notes|mode)?\b/i.test(q)}
  function obviousOtherTask(q){return /\b(look at this|take (?:a )?(?:picture|photo)|camera button|saved picture|uploaded picture|search (?:the )?web|look up online|weather|timer|remind me|read this (?:paper|document))\b/i.test(q)}

  async function answerFromVisit(q,session){
    const refreshed=getSession(session.id)||session;
    if(!String(refreshed.transcript||'').trim())await retryMissingTranscripts(refreshed);
    const ready=getSession(refreshed.id)||refreshed,transcript=String(ready.transcript||'').trim();
    if(!transcript){const msg='I have the visit audio saved, but it has not transcribed yet. Tap Analyze Visit and I will retry the transcription.';setReply(msg,msg);return msg}
    const prompt=`Answer the user's question using the field-visit transcript below as the primary source. Be precise about counts, locations, customer requests and unresolved items. Do not invent details. If the transcript is unclear or conflicting, say that.\n\nUSER QUESTION: ${q}\n\nFIELD VISIT TRANSCRIPT:\n${transcript.slice(-100000)}`;
    state('Reviewing customer visit…');badge('Reading Visit');chip('VISIT MEMORY');
    const r=await fetch(BACKEND+'/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:prompt,memory:'',memoryMode:'deep',personality:persona(),visionActive:false,source:'visit memory'}),cache:'no-store'}),raw=await r.text();
    if(!r.ok)throw new Error(raw||`HTTP ${r.status}`);
    const j=JSON.parse(raw),answer=String(j.text||'No answer').trim(),speech=j.speech||answer;setReply(answer,speech);addMem({user:q,assistant:answer,persona:persona(),visit:true,visitId:ready.id});state(active?'Visit Memory ON — recording continues.':'Visit saved — ready for questions.');badge(active?'Recording Visit':'Eara Ready');window.say?.(speech);return answer
  }

  async function playVisit(visitId){
    const segs=await audioSegments(visitId);if(!segs.length){const msg='No saved audio segments were found for this visit.';setReply(msg,msg);return}
    const token=++playbackToken;state(`Playing saved visit audio — ${segs.length} segment${segs.length===1?'':'s'}…`);badge('Playing Visit Audio');
    for(let i=0;i<segs.length;i++){
      if(token!==playbackToken)break;
      const seg=segs[i];await new Promise(resolve=>{
        const url=URL.createObjectURL(seg.blob),a=new Audio(url);a.playsInline=true;
        const done=()=>{URL.revokeObjectURL(url);resolve()};a.onended=done;a.onerror=done;state(`Playing visit audio ${i+1} of ${segs.length}…`);a.play().catch(done);
      });
    }
    if(token===playbackToken){state('Visit audio playback finished.');badge('Eara Ready')}
  }

  async function renderVisitPanel(){
    const host=$('#visitArchive');if(!host)return;const sessions=loadSessions().slice(-5).reverse();
    if(!sessions.length){host.innerHTML='<div class="small">No saved customer visits yet.</div>';return}
    const cards=[];
    for(const s of sessions){
      let segCount=s.audioSegments||0;if(!segCount){try{segCount=(await audioSegments(s.id)).length}catch(_){}}
      const mins=Math.max(1,Math.round(((s.endedAt||Date.now())-s.startedAt)/60000));
      cards.push(`<div class="mem" style="margin-top:9px"><div class="small">${new Date(s.startedAt).toLocaleString()} · ${mins} min · ${segCount} audio segments saved</div><b>${s.active?'Visit recording in progress':'Saved customer visit'}</b>${s.summary?`<div style="margin-top:6px">${escapeHtml(s.summary)}</div>`:`<div class="small" style="margin-top:6px">Transcript: ${(s.transcript||'').length.toLocaleString()} chars · ${s.transcribedSegments||0} segments transcribed${s.transcriptionErrors?` · ${s.transcriptionErrors} transcription errors`:''}</div>`}<div class="row" style="margin-top:8px"><button type="button" data-play-visit="${s.id}">Play Audio</button><button type="button" data-analyze-visit="${s.id}">Analyze Visit</button></div></div>`)
    }
    host.innerHTML=cards.join('');
    host.querySelectorAll('[data-play-visit]').forEach(b=>b.onclick=()=>playVisit(b.getAttribute('data-play-visit')));
    host.querySelectorAll('[data-analyze-visit]').forEach(b=>b.onclick=async()=>{const s=getSession(b.getAttribute('data-analyze-visit'));if(s)await analyzeVisit(s,true)});
  }
  function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

  function updateUi(){
    const b=$('#visitBtn'),s=$('#visitStatus');if(b){b.textContent=active?'Stop Visit Memory':'Start Visit Memory';b.classList.toggle('green',active)}
    if(s){const mins=current?Math.max(0,Math.round((Date.now()-current.startedAt)/60000)):0,segments=current?.audioSegments||0,chars=current?.transcript?.length||0;s.textContent=active?`Visit Memory ON · ${mins} min · ${segments} audio segments saved · ${chars.toLocaleString()} transcript chars`:(latestSession()?`Last visit: ${latestSession().audioSegments||0} audio segments saved`:'Visit Memory OFF')}
  }

  function installUi(){
    const controls=$('#mediaControls'),pad=controls?.parentElement;
    if(pad&&!$('#visitBtn')){
      const b=document.createElement('button');b.id='visitBtn';b.type='button';b.style.cssText='width:100%;margin-top:9px';b.textContent='Start Visit Memory';b.onclick=e=>{e.preventDefault();active?stop():start()};pad.insertBefore(b,$('#state')||null);
      const s=document.createElement('div');s.id='visitStatus';s.className='small';s.style.marginTop='6px';pad.insertBefore(s,$('#state')||null);
    }
    const memPad=$('#memory .pad');
    if(memPad&&!$('#visitArchive')){const wrap=document.createElement('div');wrap.id='visitArchiveWrap';wrap.style.marginTop='14px';wrap.innerHTML='<b>VISIT AUDIO + ANALYSIS</b><div class="small" style="margin-top:5px">Visit Memory stores the actual audio locally on this device in short playable segments, transcribes it, and builds estimate notes. Use Play Audio to verify the recording or Analyze Visit to retry transcription/analysis.</div><div id="visitArchive"></div>';memPad.insertBefore(wrap,$('#memoryList')||null)}
    const core=$('#settings .pad');
    if(core&&!$('#visitHelpV32')){const d=document.createElement('div');d.id='visitHelpV32';d.className='small';d.style.marginTop='12px';d.textContent='Visit Memory v32 stores the actual visit audio locally in IndexedDB, transcribes each saved segment, and analyzes the transcript when the visit ends. Audio is not uploaded for storage; only each segment is sent temporarily to EARA transcription. Keep the PWA open for long visits. iPhone may suspend recording if the app is locked or fully backgrounded. Use only when any required recording consent has been obtained.';core.appendChild(d)}
    updateUi();renderVisitPanel();
  }

  function wrapAsk(){
    if(wrapped||typeof window.askAI!=='function')return;const prev=window.askAI;
    window.askAI=async q=>{
      const text=String(q||'').trim();if(!text)return prev(q);
      if(isControl(text)){
        if(wantsStart(text)){start();const msg='Visit Memory is on. I am saving the actual audio and transcribing the conversation while the app stays open.';setReply(msg,msg);window.say?.(msg);return msg}
        await stop();return window.__earaLastReply||'Visit saved.';
      }
      if(/\b(analyze|summarize|review)\b[\s\S]{0,30}\b(visit|estimate|customer|meeting|recording)\b/i.test(text)){const s=sessionForRecall();if(s)return analyzeVisit(s,true)}
      const s=sessionForRecall();if(s&&!obviousOtherTask(text)){try{return await answerFromVisit(text,s)}catch(_){return prev(q)}}
      return prev(q)
    };
    wrapped=true;
  }

  window.addEventListener('eara-media-ready',()=>{installUi();wrapAsk();if(active&&!recorder)beginChunk()});
  window.addEventListener('eara-mic-enabled',()=>{if(active&&!recorder)beginChunk()});
  window.addEventListener('eara-mic-disabled',()=>{if(active){clearTimers();try{if(recorder?.state==='recording')recorder.stop()}catch(_){}}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){installUi();wrapAsk();if(active&&!recorder)beginChunk()}else if(active)state('Visit Memory may pause while EARA is in the background.')});
  document.querySelectorAll('nav button').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.tab==='memory')setTimeout(renderVisitPanel,50)}));

  const resume=nowSession();if(resume){current=resume;active=true}
  setTimeout(()=>{installUi();wrapAsk();if(active)beginChunk()},120);
})();

