/* Agent 1.0 v40 native live conversation + ORDRO EP6 integration.
   - EP6 stays on local Wi-Fi.
   - Agent internet stays on validated Ethernet/cellular/Internet Wi-Fi.
   - Live conversation is a listen -> send -> speak -> listen loop.
   - When EP6 live view is open, every conversational turn includes the current frame. */
(function(){
  'use strict';

  const phoneCamera=window.openCamera;
  window.AgentPhoneCamera=phoneCamera;
  window.openPhoneCamera=phoneCamera;

  if(!document.getElementById('agentUpgradeV36')){
    const s=document.createElement('script');
    s.id='agentUpgradeV36';
    s.src='upgrade-v36.js?v=40';
    s.async=true;
    document.head.appendChild(s);
  }

  const bridge=window.EARANative;
  if(!bridge||typeof bridge.getWearableCameraStatus!=='function')return;

  let wearable={supported:true,state:'disconnected',ready:false};
  let liveTalk=false;
  let liveSpeaking=false;
  let liveAudio=null;
  let liveCameraOpen=false;
  let liveCameraTimer=0;
  let restartTimer=0;
  let sendingVoiceTurn=false;
  let lastLiveFrame='';
  let lastLiveFrameAt=0;

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
    if(s?.ready)return 'EP6 live';
    if(s?.state==='waiting-first-frame')return 'EP6 stream open - waiting for video';
    if(s?.state==='connecting'||s?.state==='connecting-stream')return 'Connecting EP6…';
    if(s?.state==='needs-wifi')return 'Join the EP6 Wi-Fi';
    if(s?.state==='stream-error')return 'EP6 Wi-Fi found - video stream unavailable';
    return 'EP6 camera not connected';
  }
  function networkLabel(){
    const n=readNetwork();
    if(n.internetTransport==='ethernet')return 'Internet: USB Ethernet';
    if(n.internetTransport==='cellular')return 'Internet: cellular';
    if(n.internetTransport==='wifi')return 'Internet: Wi-Fi';
    return 'Internet: Android default';
  }

  function injectV40Styles(){
    if($('#agentV40Style'))return;
    const st=document.createElement('style');
    st.id='agentV40Style';
    st.textContent=`
      .main{height:100dvh!important;min-height:0!important;overflow:hidden!important}
      .chat{min-height:0!important;overflow-y:auto!important;overflow-x:hidden!important;touch-action:pan-y!important;-webkit-overflow-scrolling:touch!important;overscroll-behavior-y:contain!important}
      .messages{min-height:100%;}
      .menu{display:grid!important}
      body.v40-sidebar-hidden .app{grid-template-columns:0 minmax(0,1fr)!important}
      body.v40-sidebar-hidden .sidebar{display:none!important}
      #ep6LiveModal{background:#050505!important;padding:0!important;align-items:stretch!important;justify-content:stretch!important}
      #ep6LiveModal .cameraCard{width:100%!important;height:100%!important;max-width:none!important;border:0!important;border-radius:0!important;background:#050505!important;color:#fff!important;display:flex!important;flex-direction:column!important}
      #ep6LiveHeader{height:58px;flex:0 0 58px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;background:#111;color:#fff}
      #ep6LiveVideoWrap{position:relative;flex:1;min-height:0;display:flex;align-items:center;justify-content:center;background:#000;overflow:hidden}
      #ep6LiveImage{width:100%!important;height:100%!important;object-fit:contain!important;background:#000!important}
      #ep6LiveOverlay{position:absolute;left:12px;bottom:12px;right:12px;display:flex;justify-content:space-between;gap:8px;pointer-events:none}
      #ep6LiveOverlay span{background:rgba(0,0,0,.62);color:#fff;border-radius:999px;padding:7px 10px;font-size:12px;backdrop-filter:blur(8px)}
      #ep6LiveControls{flex:0 0 auto;display:flex;justify-content:center;align-items:center;gap:18px;padding:14px 16px calc(env(safe-area-inset-bottom) + 18px);background:#111}
      #ep6LiveControls button{width:58px;height:58px;border-radius:50%;border:1px solid #3b3b3b;background:#222;color:#fff;display:grid;place-items:center;font-size:22px}
      #ep6LiveControls button.on{background:#fff;color:#111}
      #ep6LiveClose{font-size:15px!important;font-weight:650}
      @media(max-width:760px){.sidebar.open{transform:translateX(0)!important}.drawerShade.show{opacity:1!important;pointer-events:auto!important}}
    `;
    document.head.appendChild(st);
  }

  function installHistoryFix(){
    const menu=$('#menuBtn'),side=$('#sidebar'),shade=$('#drawerShade');
    if(!menu||!side||menu.dataset.v40History==='1')return;
    menu.dataset.v40History='1';
    menu.onclick=e=>{
      e.preventDefault();e.stopPropagation();
      if(window.matchMedia('(max-width:760px)').matches){
        const opening=!side.classList.contains('open');
        side.classList.toggle('open',opening);
        shade?.classList.toggle('show',opening);
      }else{
        document.body.classList.toggle('v40-sidebar-hidden');
      }
    };
    if(shade)shade.onclick=()=>{side.classList.remove('open');shade.classList.remove('show')};
  }

  function ensurePhoneCameraButton(){
    const box=$('#attachments'),ep6=$('#cameraBtn');
    if(!box||!ep6||$('#phoneCameraBtn'))return;
    const b=ep6.cloneNode(true);
    b.id='phoneCameraBtn';b.title='Phone camera';
    const lab=b.querySelector('small');if(lab)lab.textContent='Phone camera';
    b.onclick=e=>{e.preventDefault();e.stopPropagation();hideAttachments();if(typeof phoneCamera==='function')phoneCamera()};
    ep6.insertAdjacentElement('afterend',b);
  }

  function syncUi(){
    const camera=$('#cameraBtn');
    if(camera){
      camera.dataset.source='ep6-live';
      camera.title=wearable.ready?'ORDRO EP6 Plus live camera':'Connect ORDRO EP6 Plus live camera';
      const label=camera.querySelector('small');if(label)label.textContent='EP6 live camera';
      camera.onclick=e=>{e.preventDefault();e.stopPropagation();showLiveCamera()};
    }
    const mic=$('#dictateBtn');
    if(mic){
      mic.title='Live conversation';mic.setAttribute('aria-label','Live conversation');
      mic.onclick=e=>{e.preventDefault();toggleLiveTalk()};
      mic.classList.toggle('on',liveTalk);
    }
    const voice=$('#voiceToggle');
    if(voice){
      voice.title='Live conversation';voice.setAttribute('aria-label','Live conversation');
      voice.onclick=e=>{e.preventDefault();toggleLiveTalk()};
      voice.classList.toggle('on',liveTalk);
    }
    $('#ep6LiveTalk')?.classList.toggle('on',liveTalk);
    const live=$('#liveCameraBtn');if(live)live.classList.toggle('on',liveCameraOpen&&wearable.ready);
  }

  function applyStatus(s){
    wearable=s||wearable;
    syncUi();
    const state=$('#ep6LiveState');if(state)state.textContent=wearableLabel(wearable);
    if(!busy&&wearable.state!=='disconnected')setStatus(wearableLabel(wearable),wearable.ready?'ok':(wearable.state==='stream-error'?'error':'busy'));
    if(wearable.ready&&liveCameraOpen)startLiveFrames();
  }

  function connectWearable(){
    hideAttachments();
    try{
      if(typeof bridge.refreshWearableCamera==='function'){
        const refreshed=parseStatus(bridge.refreshWearableCamera());
        applyStatus(refreshed);
        if(refreshed.ready)return refreshed;
      }
      const s=parseStatus(bridge.connectWearableCamera());
      applyStatus(s);
      if(!s.ready)setStatus('Connecting to the EP6 local Wi-Fi. Agent Internet stays on Ethernet/cellular.','busy');
      return s;
    }catch(_){setStatus('Could not start EP6 connection','error');return wearable}
  }

  function captureWearable(select=false){
    try{
      const s=readStatus();
      if(!s.ready)return '';
      const frame=String(bridge.captureWearableFrame()||'');
      if(frame.startsWith('data:image/')){
        lastLiveFrame=frame;lastLiveFrameAt=Date.now();
        if(select){selectImage(frame,'ORDRO EP6 Plus');setStatus('EP6 frame attached','ok')}
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
    modal.id='ep6LiveModal';modal.className='cameraModal';
    modal.innerHTML=`<div class="cameraCard">
      <div id="ep6LiveHeader"><strong>ORDRO EP6 Plus — Live with Agent</strong><span id="ep6LiveState">Connecting…</span></div>
      <div id="ep6LiveVideoWrap"><img id="ep6LiveImage" alt="EP6 live camera"><div id="ep6LiveOverlay"><span id="ep6LiveNet"></span><span id="ep6LiveVoice">Voice off</span></div></div>
      <div id="ep6LiveControls"><button id="ep6LiveClose" aria-label="Close live camera">Close</button><button id="ep6LiveTalk" aria-label="Toggle live conversation">🎙</button></div>
    </div>`;
    document.body.appendChild(modal);
    $('#ep6LiveClose').onclick=closeLiveCamera;
    $('#ep6LiveTalk').onclick=()=>toggleLiveTalk();
  }

  function refreshLiveCamera(){
    if(!liveCameraOpen)return;
    const s=readStatus(),state=$('#ep6LiveState'),net=$('#ep6LiveNet'),voice=$('#ep6LiveVoice');
    if(state)state.textContent=wearableLabel(s);
    if(net)net.textContent=networkLabel();
    if(voice)voice.textContent=liveTalk?(liveSpeaking?'Agent speaking':'Listening hands-free'):'Voice off';
    if(!s.ready)return;
    const frame=captureWearable(false),img=$('#ep6LiveImage');
    if(frame&&img)img.src=frame;
  }
  function startLiveFrames(){
    if(!liveCameraOpen)return;
    clearInterval(liveCameraTimer);
    refreshLiveCamera();
    liveCameraTimer=setInterval(refreshLiveCamera,350);
  }
  function showLiveCamera(){
    hideAttachments();injectV40Styles();ensureLiveCameraUi();
    liveCameraOpen=true;$('#ep6LiveModal').classList.add('show');syncUi();
    const s=readStatus();
    if(s.ready)startLiveFrames();
    else{connectWearable();startLiveFrames()}
    if(!liveTalk)toggleLiveTalk(true);
  }
  function closeLiveCamera(){
    liveCameraOpen=false;clearInterval(liveCameraTimer);liveCameraTimer=0;
    $('#ep6LiveModal')?.classList.remove('show');syncUi();
  }

  function addLiveCameraButton(){
    const top=document.querySelector('.topActions');if(!top)return;
    $('#liveTalkBtn')?.remove();
    if(!$('#liveCameraBtn')){
      const b=document.createElement('button');
      b.id='liveCameraBtn';b.className='iconBtn';b.title='EP6 live camera';b.setAttribute('aria-label','EP6 live camera');
      b.innerHTML='<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="3"/><circle cx="12" cy="12.5" r="3.3"/><path d="M8 6l1.2-2h5.6L16 6"/></svg>';
      b.onclick=showLiveCamera;top.insertBefore(b,top.firstChild);
    }
  }

  function stopLiveAudio(){
    try{if(liveAudio){liveAudio.pause();if(liveAudio.src?.startsWith('blob:'))URL.revokeObjectURL(liveAudio.src)}}catch(_){}
    liveAudio=null;try{speechSynthesis.cancel()}catch(_){}
  }
  async function speakLive(text){
    const msg=typeof cleanSpeech==='function'?cleanSpeech(text):String(text||'').replace(/https?:\/\/\S+/g,'').slice(0,700);
    if(!msg||!liveTalk)return;
    liveSpeaking=true;syncUi();
    try{
      stopLiveAudio();
      const r=await fetch(BACKEND+'/tts?raw=1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:msg,speaker:'asteria'}),cache:'no-store'});
      if(!r.ok)throw new Error('tts');
      const blob=await r.blob(),url=URL.createObjectURL(blob),a=new Audio(url);liveAudio=a;
      await new Promise((resolve,reject)=>{a.onended=()=>{URL.revokeObjectURL(url);if(liveAudio===a)liveAudio=null;resolve()};a.onerror=()=>{URL.revokeObjectURL(url);if(liveAudio===a)liveAudio=null;reject(new Error('audio'))};a.play().catch(reject)});
    }catch(_){
      if(liveTalk){
        try{await new Promise(resolve=>{speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(msg);u.lang='en-US';u.onend=resolve;u.onerror=resolve;speechSynthesis.speak(u)})}catch(__){}
      }
    }finally{liveSpeaking=false;syncUi()}
  }

  function clearRestart(){clearTimeout(restartTimer);restartTimer=0}
  function startListeningSoon(delay=220){
    clearRestart();if(!liveTalk||liveSpeaking||sendingVoiceTurn)return;
    restartTimer=setTimeout(()=>{
      if(!liveTalk||liveSpeaking||sendingVoiceTurn||busy)return;
      try{bridge.startListening();syncUi();setStatus('Live conversation — listening…','busy')}
      catch(_){setStatus('Live conversation microphone unavailable','error')}
    },delay);
  }
  function toggleLiveTalk(force){
    const next=typeof force==='boolean'?force:!liveTalk;
    if(next===liveTalk){syncUi();return}
    liveTalk=next;voiceOn=false;localStorage.setItem('agent10VoiceOn','0');
    clearRestart();
    if(!liveTalk){
      try{bridge.stopListening()}catch(_){}stopLiveAudio();liveSpeaking=false;sendingVoiceTurn=false;
      setStatus('Live conversation off','ok');syncUi();return;
    }
    setStatus('Live conversation on — just speak','ok');syncUi();startListeningSoon(120);
  }

  function latestAssistantText(){
    try{const t=current(),msgs=t?.messages||[];for(let i=msgs.length-1;i>=0;i--)if(msgs[i]?.role==='assistant'&&msgs[i]?.text)return String(msgs[i].text)}catch(_){}
    return '';
  }

  const baseSend=send;
  send=async function(){
    if(busy)return;
    const input=$('#prompt'),text=input?.value?.trim()||'';
    const shouldAttachLive=wearable.ready&&(liveCameraOpen||visualIntent(text));
    if(shouldAttachLive&&!selectedImage&&!selectedFile){
      let frame=(Date.now()-lastLiveFrameAt<900)?lastLiveFrame:'';
      if(!frame)frame=captureWearable(false);
      if(frame)selectImage(frame,'ORDRO EP6 Plus live frame');
    }else if(visualIntent(text)&&!wearable.ready&&!selectedImage&&!selectedFile){
      showLiveCamera();setStatus('EP6 must connect before Agent can see it.','busy');return;
    }
    const talkThisTurn=liveTalk;
    const savedVoice=voiceOn;voiceOn=false;
    try{await baseSend()}finally{voiceOn=savedVoice}
    if(talkThisTurn&&liveTalk){
      const reply=latestAssistantText();if(reply)await speakLive(reply);
      sendingVoiceTurn=false;startListeningSoon(260);
    }
  };
  $('#sendBtn').onclick=send;

  // The EP6 attachment opens LIVE mode. It never falls back to the Android camera.
  openCamera=showLiveCamera;
  $('#cameraBtn').onclick=e=>{e.preventDefault();e.stopPropagation();showLiveCamera()};

  const baseLoadCapabilities=loadCapabilities;
  loadCapabilities=async function(){
    await baseLoadCapabilities();
    const box=$('#liveTools');if(!box)return;
    const s=readStatus(),n=readNetwork();
    const card=document.createElement('div');card.className='toolCard';
    card.innerHTML='<div class="toolName">ORDRO EP6 Plus live camera</div><div class="toolState '+(s.ready?'':'connect')+'">'+(s.ready?'● Live':'○ '+esc(wearableLabel(s)))+'</div><div class="toolReason">EP6 video stays on local Wi-Fi. '+esc(networkLabel())+' carries Agent Internet traffic.</div>';
    box.prepend(card);
    if(Object.keys(n).length){const net=document.createElement('div');net.className='toolCard';net.innerHTML='<div class="toolName">Split network routing</div><div class="toolState">'+esc(networkLabel())+'</div><div class="toolReason">USB Ethernet is preferred, then cellular, then validated Internet Wi-Fi.</div>';box.prepend(net)}
  };

  // Native speech is now continuous conversation rather than one-shot dictation.
  window.addEventListener('eara-native-speech',e=>{
    const d=e.detail||{};
    if(d.type==='result'&&d.final&&d.text){
      if(liveTalk){
        sendingVoiceTurn=true;clearRestart();
        const p=$('#prompt');if(p){p.value=String(d.text).trim();autoSize();p.focus()}
        if(liveCameraOpen&&wearable.ready){const frame=(Date.now()-lastLiveFrameAt<900)?lastLiveFrame:captureWearable(false);if(frame)selectImage(frame,'ORDRO EP6 Plus live frame')}
        setTimeout(()=>send(),60);
      }else{
        const p=$('#prompt');if(p){p.value=(p.value.trim()?p.value.trim()+' ':'')+String(d.text).trim();autoSize();p.focus()}
      }
    }
    if((d.type==='end'||d.type==='error')&&liveTalk&&!sendingVoiceTurn&&!liveSpeaking&&!busy)startListeningSoon(d.type==='error'?500:220);
  });

  window.addEventListener('eara-native-wearable',e=>applyStatus(e.detail||{}));
  window.addEventListener('eara-native-network',()=>{if(!busy&&!liveTalk)setStatus(networkLabel(),'ok');refreshLiveCamera()});

  injectV40Styles();installHistoryFix();ensureLiveCameraUi();addLiveCameraButton();ensurePhoneCameraButton();syncUi();
  setTimeout(()=>{installHistoryFix();ensurePhoneCameraButton();addLiveCameraButton();syncUi();try{if(typeof bridge.refreshWearableCamera==='function')bridge.refreshWearableCamera()}catch(_){}applyStatus(readStatus())},500);
  setTimeout(()=>{installHistoryFix();ensurePhoneCameraButton();syncUi()},1400);

  window.AgentV40={
    version:'40',
    toggleLiveTalk,
    showLiveCamera,
    closeLiveCamera,
    connectEP6:connectWearable,
    captureEP6:()=>captureWearable(false),
    getStatus:()=>readStatus(),
    getNetwork:()=>readNetwork(),
    isLiveTalk:()=>liveTalk,
    isLiveCamera:()=>liveCameraOpen
  };
})();
