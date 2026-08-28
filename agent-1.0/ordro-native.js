/* Agent 1.0 v39 native ORDRO EP6 Plus integration.
   EP6 camera traffic stays on the camera Wi-Fi. Agent internet can use
   cellular, Ethernet, or Android's validated default network. */
(function(){
  'use strict';

  window.AgentPhoneCamera=window.openCamera;

  if(!document.getElementById('agentUpgradeV36')){
    const s=document.createElement('script');
    s.id='agentUpgradeV36';
    s.src='upgrade-v36.js?v=36';
    s.async=true;
    document.head.appendChild(s);
  }

  const bridge=window.EARANative;
  if(!bridge||typeof bridge.getWearableCameraStatus!=='function')return;

  let wearable={supported:true,state:'disconnected',ready:false};
  let nativeSpeech=false;
  let liveTalk=false;
  let liveAudio=null;
  let liveCameraTimer=0;
  let openLiveWhenReady=false;

  function parseStatus(raw){
    try{return typeof raw==='string'?JSON.parse(raw):raw||{}}
    catch(_){return {supported:true,state:'error',ready:false,error:'Invalid camera status'}}
  }
  function readStatus(){
    try{wearable=parseStatus(bridge.getWearableCameraStatus());return wearable}
    catch(_){return wearable}
  }
  function readNetwork(){
    try{return typeof bridge.getNetworkRoutingStatus==='function'?parseStatus(bridge.getNetworkRoutingStatus()):{}}
    catch(_){return {}}
  }
  function wearableLabel(s){
    if(s?.ready)return 'EP6 camera ready';
    if(s?.state==='waiting-first-frame')return 'EP6 connected - waiting for video';
    if(s?.state==='connecting'||s?.state==='connecting-stream')return 'Connecting EP6 camera...';
    if(s?.state==='needs-wifi')return 'Connect to EP6 Wi-Fi';
    if(s?.state==='stream-error')return 'EP6 Wi-Fi connected - video unavailable';
    return 'EP6 camera not connected';
  }
  function networkLabel(){
    const n=readNetwork();
    if(n.internetTransport==='ethernet')return 'Internet: USB Ethernet';
    if(n.internetTransport==='cellular')return 'Internet: cellular';
    if(n.internetTransport==='wifi')return 'Internet: Wi-Fi';
    if(n.cellularBound)return 'Internet: cellular';
    return 'Internet: Android default network';
  }

  function applyStatus(s){
    wearable=s||wearable;
    const camera=$('#cameraBtn');
    if(camera){
      camera.title=wearable.ready?'ORDRO EP6 Plus camera ready':'Connect ORDRO EP6 Plus';
      const label=camera.querySelector('small');
      if(label)label.textContent='EP6 camera';
    }
    const live=$('#liveCameraBtn');
    if(live)live.classList.toggle('on',!!wearable.ready);
    if(!busy&&wearable.state!=='disconnected')setStatus(wearableLabel(wearable),wearable.ready?'ok':(wearable.state==='stream-error'?'error':'busy'));
    if(wearable.ready&&openLiveWhenReady){
      openLiveWhenReady=false;
      showLiveCamera();
    }
  }

  function connectWearable(){
    hideAttachments();
    try{
      const s=parseStatus(bridge.connectWearableCamera());
      applyStatus(s);
      if(!s.ready)setStatus('Connect/approve the EP6 Wi-Fi. Internet stays on Ethernet or cellular.','busy');
    }catch(_){setStatus('Could not start EP6 Wi-Fi connection','error')}
  }

  function captureWearable(select=true){
    try{
      const s=readStatus();
      if(!s.ready)return '';
      const frame=String(bridge.captureWearableFrame()||'');
      if(frame.startsWith('data:image/')){
        if(select){
          selectImage(frame,'ORDRO EP6 Plus');
          setStatus('EP6 camera image ready','ok');
          $('#prompt')?.focus();
        }
        return frame;
      }
    }catch(_){}
    return '';
  }

  function visualIntent(text){
    return /\b(what (?:do you|can you) see|what am i (?:looking|pointing) at|look at|look around|read this|read that|identify this|identify that|what is this|what is that|can you see|inspect this|inspect that|camera|in front of me|ahead of me|showing you|this device|this part|these wires|this label)\b/i.test(String(text||''));
  }

  function ensureLiveCameraUi(){
    if($('#ep6LiveModal'))return;
    const modal=document.createElement('div');
    modal.id='ep6LiveModal';
    modal.className='cameraModal';
    modal.innerHTML='<div class="cameraCard"><div style="padding:12px 14px;font-weight:650;display:flex;justify-content:space-between;align-items:center"><span>ORDRO EP6 Plus - Live Camera</span><span id="ep6LiveState" style="font-size:12px;color:#777"></span></div><img id="ep6LiveImage" alt="EP6 live camera" style="display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:#111"><div class="cameraBar"><button id="ep6LiveClose">Close</button><button class="use" id="ep6LiveUse">Use current frame</button></div></div>';
    document.body.appendChild(modal);
    $('#ep6LiveClose').onclick=closeLiveCamera;
    $('#ep6LiveUse').onclick=()=>{
      const frame=captureWearable(true);
      if(frame)closeLiveCamera();
      else setStatus('No EP6 frame is available yet','error');
    };
    modal.addEventListener('click',e=>{if(e.target===modal)closeLiveCamera()});
  }

  function refreshLiveCamera(){
    const img=$('#ep6LiveImage'),st=$('#ep6LiveState');
    if(!img)return;
    const s=readStatus();
    if(st)st.textContent=wearableLabel(s);
    if(!s.ready)return;
    const frame=captureWearable(false);
    if(frame)img.src=frame;
  }
  function showLiveCamera(){
    ensureLiveCameraUi();
    const s=readStatus();
    if(!s.ready){
      openLiveWhenReady=true;
      connectWearable();
      return;
    }
    $('#ep6LiveModal').classList.add('show');
    refreshLiveCamera();
    clearInterval(liveCameraTimer);
    liveCameraTimer=setInterval(refreshLiveCamera,650);
  }
  function closeLiveCamera(){
    clearInterval(liveCameraTimer);liveCameraTimer=0;
    $('#ep6LiveModal')?.classList.remove('show');
  }

  function addTopButtons(){
    const top=document.querySelector('.topActions');
    if(!top)return;
    if(!$('#liveCameraBtn')){
      const b=document.createElement('button');
      b.id='liveCameraBtn';b.className='iconBtn';b.title='Live camera';b.setAttribute('aria-label','Live camera');
      b.innerHTML='<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="3"/><circle cx="12" cy="12.5" r="3.3"/><path d="M8 6l1.2-2h5.6L16 6"/></svg>';
      b.onclick=showLiveCamera;
      top.insertBefore(b,top.firstChild);
    }
    if(!$('#liveTalkBtn')){
      const b=document.createElement('button');
      b.id='liveTalkBtn';b.className='iconBtn';b.title='Live conversation';b.setAttribute('aria-label','Live conversation');
      b.innerHTML='<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6"/></svg>';
      b.onclick=toggleLiveTalk;
      top.insertBefore(b,top.firstChild);
    }
  }

  function stopLiveAudio(){
    try{if(liveAudio){liveAudio.pause();if(liveAudio.src?.startsWith('blob:'))URL.revokeObjectURL(liveAudio.src)}}catch(_){}
    liveAudio=null;
    try{speechSynthesis.cancel()}catch(_){}
  }

  async function speakLive(text){
    const msg=typeof cleanSpeech==='function'?cleanSpeech(text):String(text||'').slice(0,700);
    if(!msg||!liveTalk)return;
    stopLiveAudio();
    try{
      const r=await fetch(BACKEND+'/tts?raw=1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:msg,speaker:'asteria'}),cache:'no-store'});
      if(!r.ok)throw new Error('tts');
      const blob=await r.blob(),url=URL.createObjectURL(blob),a=new Audio(url);
      liveAudio=a;
      await new Promise((resolve,reject)=>{
        a.onended=()=>{URL.revokeObjectURL(url);if(liveAudio===a)liveAudio=null;resolve()};
        a.onerror=()=>{URL.revokeObjectURL(url);if(liveAudio===a)liveAudio=null;reject(new Error('audio'))};
        a.play().catch(reject);
      });
      return;
    }catch(_){}
    if(!liveTalk)return;
    try{
      await new Promise(resolve=>{
        speechSynthesis.cancel();
        const u=new SpeechSynthesisUtterance(msg);u.lang='en-US';u.onend=resolve;u.onerror=resolve;speechSynthesis.speak(u);
      });
    }catch(_){}
  }

  function startListeningSoon(delay=250){
    if(!liveTalk)return;
    setTimeout(()=>{
      if(!liveTalk||busy)return;
      try{
        bridge.startListening();
        $('#liveTalkBtn')?.classList.add('on');
        $('#dictateBtn')?.classList.add('on');
        setStatus('Live conversation - listening...','busy');
      }catch(_){setStatus('Live conversation microphone unavailable','error')}
    },delay);
  }

  function toggleLiveTalk(){
    liveTalk=!liveTalk;
    const b=$('#liveTalkBtn');
    b?.classList.toggle('on',liveTalk);
    if(!liveTalk){
      try{bridge.stopListening()}catch(_){}
      stopLiveAudio();
      $('#dictateBtn')?.classList.remove('on');
      setStatus('Live conversation off','ok');
      return;
    }
    setStatus('Live conversation on - speak normally','ok');
    startListeningSoon(120);
  }

  function latestAssistantText(){
    try{
      const t=current();
      const msgs=t?.messages||[];
      for(let i=msgs.length-1;i>=0;i--)if(msgs[i]?.role==='assistant'&&msgs[i]?.text)return String(msgs[i].text);
    }catch(_){}
    return '';
  }

  const baseSend=send;
  send=async function(){
    const text=$('#prompt')?.value?.trim()||'';
    if(!busy&&!selectedImage&&!selectedFile&&visualIntent(text)){
      const s=readStatus();
      if(s.ready){
        const frame=captureWearable(false);
        if(frame)selectImage(frame,'ORDRO EP6 Plus');
      }else{
        connectWearable();
        setStatus('EP6 must connect before I can see it.','busy');
        if(liveTalk)startListeningSoon(1200);
        return;
      }
    }
    const talkThisTurn=liveTalk;
    const savedVoice=voiceOn;
    if(talkThisTurn)voiceOn=false;
    try{await baseSend()}
    finally{if(talkThisTurn)voiceOn=savedVoice}
    if(talkThisTurn&&liveTalk){
      const reply=latestAssistantText();
      if(reply)await speakLive(reply);
      startListeningSoon(250);
    }
  };
  $('#sendBtn').onclick=send;

  openCamera=async function(){
    const s=readStatus();
    if(s.ready){
      if(!captureWearable(true))setStatus('EP6 is connected but no frame is available yet','error');
      return;
    }
    connectWearable();
  };
  $('#cameraBtn').onclick=openCamera;

  const baseLoadCapabilities=loadCapabilities;
  loadCapabilities=async function(){
    await baseLoadCapabilities();
    const box=$('#liveTools');
    if(!box)return;
    const s=readStatus(),n=readNetwork();
    const card=document.createElement('div');
    card.className='toolCard';
    card.innerHTML='<div class="toolName">ORDRO EP6 Plus wearable camera</div><div class="toolState '+(s.ready?'':'connect')+'">'+(s.ready?'Live':'Not live - '+esc(wearableLabel(s)))+'</div><div class="toolReason">EP6 video uses its local Wi-Fi only. '+esc(networkLabel())+' carries Agent 1.0 Internet traffic.</div>';
    box.prepend(card);
    if(Object.keys(n).length){
      const net=document.createElement('div');net.className='toolCard';
      net.innerHTML='<div class="toolName">Split network routing</div><div class="toolState">'+esc(networkLabel())+'</div><div class="toolReason">Camera Wi-Fi remains local while cloud traffic uses a validated Internet connection.</div>';
      box.prepend(net);
    }
  };

  try{nativeSpeech=!!bridge.isAvailable()}catch(_){nativeSpeech=false}
  if(nativeSpeech){
    const mic=$('#dictateBtn');
    if(mic){
      mic.style.display='';
      mic.onclick=()=>{
        if(liveTalk){toggleLiveTalk();return}
        try{bridge.startListening();setStatus('Listening...','busy');mic.classList.add('on')}
        catch(_){setStatus('Voice input unavailable','error')}
      };
    }
    window.addEventListener('eara-native-speech',e=>{
      const d=e.detail||{};
      if(d.type==='result'&&d.final&&d.text){
        const p=$('#prompt');
        if(p){
          if(liveTalk)p.value=String(d.text).trim();
          else p.value=(p.value.trim()?p.value.trim()+' ':'')+String(d.text).trim();
          autoSize();p.focus();
          if(liveTalk)setTimeout(()=>send(),80);
        }
      }
      if(d.type==='end'||d.type==='error'){
        $('#dictateBtn')?.classList.remove('on');
        if(!liveTalk&&!busy)setStatus(d.type==='error'?'Voice input unavailable':'Ready',d.type==='error'?'error':'ok');
      }
    });
  }

  window.addEventListener('eara-native-wearable',e=>applyStatus(e.detail||{}));
  window.addEventListener('eara-native-network',()=>{if(!busy)setStatus(networkLabel(),'ok')});
  addTopButtons();
  ensureLiveCameraUi();
  setTimeout(()=>{
    try{if(typeof bridge.refreshWearableCamera==='function')bridge.refreshWearableCamera()}catch(_){}
    applyStatus(readStatus());
  },650);
})();
