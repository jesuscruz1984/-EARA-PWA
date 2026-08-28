/* Agent 1.0 native ORDRO EP6 Plus integration.
   Loaded only as an enhancement: browser/PWA behavior remains unchanged. */
(function(){
  // Preserve the normal phone-camera function before the wearable integration
  // replaces openCamera. The v36 UI exposes both Phone camera and EP6 camera.
  window.AgentPhoneCamera=window.openCamera;

  // Load interaction/document fixes for both PWA and APK builds. This is a new
  // same-origin asset so older cached index.html files still receive the fix.
  if(!document.getElementById('agentUpgradeV36')){
    const s=document.createElement('script');s.id='agentUpgradeV36';s.src='upgrade-v36.js?v=36';s.async=true;document.head.appendChild(s);
  }

  const bridge=window.EARANative;
  if(!bridge||typeof bridge.getWearableCameraStatus!=='function')return;

  let wearable={supported:true,state:'disconnected',ready:false};
  let nativeSpeech=false;

  function parseStatus(raw){
    try{return typeof raw==='string'?JSON.parse(raw):raw||{}}catch(_){return {supported:true,state:'error',ready:false,error:'Invalid camera status'}}
  }
  function readStatus(){
    try{wearable=parseStatus(bridge.getWearableCameraStatus());return wearable}catch(_){return wearable}
  }
  function wearableLabel(s){
    if(s?.ready)return 'EP6 camera ready';
    if(s?.state==='connecting'||s?.state==='connecting-stream')return 'Connecting EP6 camera…';
    if(s?.state==='needs-wifi')return 'Select EP6 Wi-Fi';
    if(s?.state==='stream-error')return 'EP6 connected — preview not found';
    return 'EP6 camera not connected';
  }
  function applyStatus(s){
    wearable=s||wearable;
    const camera=$('#cameraBtn');
    if(camera){
      camera.title=wearable.ready?'ORDRO EP6 Plus camera ready':'Connect ORDRO EP6 Plus';
      const label=camera.querySelector('small');
      if(label)label.textContent='EP6 camera';
    }
    if(!busy&&wearable.state!=='disconnected')setStatus(wearableLabel(wearable),wearable.ready?'ok':(wearable.state==='stream-error'?'error':'busy'));
  }
  function connectWearable(){
    hideAttachments();
    try{
      const s=parseStatus(bridge.connectWearableCamera());
      applyStatus(s);
      if(!s.ready)setStatus('Select the EP6 camera Wi-Fi when Android asks','busy');
    }catch(_){setStatus('Could not start EP6 Wi-Fi connection','error')}
  }
  function captureWearable(select=true){
    try{
      const s=readStatus();
      if(!s.ready)return '';
      const frame=String(bridge.captureWearableFrame()||'');
      if(frame.startsWith('data:image/')){
        if(select){selectImage(frame,'ORDRO EP6 Plus');setStatus('EP6 camera image ready','ok');$('#prompt').focus()}
        return frame;
      }
    }catch(_){}
    return '';
  }
  function visualIntent(text){
    return /\b(what (?:do you|can you) see|what am i (?:looking|pointing) at|look at|look around|read this|read that|identify this|identify that|what is this|what is that|can you see|inspect this|inspect that|camera|in front of me|ahead of me|showing you|this device|this part|these wires|this label)\b/i.test(String(text||''));
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
        setStatus('Connect EP6, then ask again — password 12345678','busy');
        return;
      }
    }
    return baseSend();
  };
  $('#sendBtn').onclick=send;

  openCamera=async function(){
    const s=readStatus();
    if(s.ready){
      if(!captureWearable(true))setStatus('EP6 stream is connected but no frame was available yet','error');
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
    const s=readStatus();
    const card=document.createElement('div');
    card.className='toolCard';
    card.innerHTML=`<div class="toolName">ORDRO EP6 Plus wearable camera</div><div class="toolState ${s.ready?'':'connect'}">${s.ready?'● Live':'○ '+esc(wearableLabel(s))}</div><div class="toolReason">Head-camera frames can be sent directly to Agent 1.0 vision. Camera Wi-Fi stays local while AI traffic uses the phone internet connection.</div>`;
    box.prepend(card);
  };

  try{nativeSpeech=!!bridge.isAvailable()}catch(_){nativeSpeech=false}
  if(nativeSpeech){
    const mic=$('#dictateBtn');
    if(mic){
      mic.style.display='';
      mic.onclick=()=>{try{bridge.startListening();setStatus('Listening…','busy');mic.classList.add('on')}catch(_){setStatus('Voice input unavailable','error')}};
    }
    window.addEventListener('eara-native-speech',e=>{
      const d=e.detail||{};
      if(d.type==='result'&&d.final&&d.text){
        const p=$('#prompt');
        if(p){p.value=(p.value.trim()?p.value.trim()+' ':'')+String(d.text).trim();autoSize();p.focus()}
      }
      if(d.type==='end'||d.type==='error'){
        $('#dictateBtn')?.classList.remove('on');
        if(!busy)setStatus(d.type==='error'?'Voice input unavailable':'Ready',d.type==='error'?'error':'ok');
      }
    });
  }

  window.addEventListener('eara-native-wearable',e=>applyStatus(e.detail||{}));
  setTimeout(()=>applyStatus(readStatus()),650);
})();
