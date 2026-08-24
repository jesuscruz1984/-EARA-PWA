// EARA v27 microphone noise filtering for PWA browsers.
(()=>{
  const KEY='earaNoiseFilterV1';
  let applying=false,lastSupported='';

  const enabled=()=>localStorage.getItem(KEY)!=='off';
  const supported=()=>navigator.mediaDevices?.getSupportedConstraints?.()||{};
  const getTrack=()=>window.getEaraStream?.()?.getAudioTracks?.()?.[0]||null;

  function buildConstraints(on){
    const s=supported(),c={};
    if(s.echoCancellation)c.echoCancellation=!!on;
    if(s.noiseSuppression)c.noiseSuppression=!!on;
    if(s.autoGainControl)c.autoGainControl=!!on;
    if(on&&s.channelCount)c.channelCount={ideal:1};
    if(on&&s.sampleRate)c.sampleRate={ideal:48000};
    if(on&&s.sampleSize)c.sampleSize={ideal:16};
    return c;
  }

  function updateButton(extra=''){
    const b=document.querySelector('#noiseBtn');
    if(!b)return;
    const on=enabled();
    b.textContent=on?'Noise Filter: ON':'Noise Filter: OFF';
    b.classList.toggle('green',on);
    b.title=extra||'Uses browser microphone noise suppression, echo cancellation, and automatic gain control when supported.';
  }

  async function applyNoiseFilter(showStatus=false){
    if(applying)return false;
    const track=getTrack();
    if(!track){updateButton(window.EARANative?'Native microphone processing is active.':'Microphone track is not ready yet.');return false}
    applying=true;
    try{
      const on=enabled(),constraints=buildConstraints(on);
      if(Object.keys(constraints).length)await track.applyConstraints(constraints);
      const settings=track.getSettings?.()||{};
      const active=[];
      if(settings.noiseSuppression===true)active.push('noise suppression');
      if(settings.echoCancellation===true)active.push('echo cancellation');
      if(settings.autoGainControl===true)active.push('auto gain');
      lastSupported=active.length?active.join(', '):'browser processing requested';
      updateButton(on?`Active: ${lastSupported}`:'Browser microphone processing disabled by EARA.');
      if(showStatus){
        const state=document.querySelector('#state');
        if(state)state.textContent=on?`Noise filter ON — ${lastSupported}.`:'Noise filter OFF.';
        setTimeout(()=>window.forceEaraListening?.(),80);
      }
      return true;
    }catch(_){
      lastSupported='iOS/browser controls the available filtering';
      updateButton(lastSupported);
      return false;
    }finally{applying=false}
  }

  async function toggle(){
    localStorage.setItem(KEY,enabled()?'off':'on');
    updateButton();
    await applyNoiseFilter(true);
  }

  function installButton(){
    const controls=document.querySelector('#mediaControls');
    if(!controls||document.querySelector('#noiseBtn'))return;
    const b=document.createElement('button');
    b.id='noiseBtn';b.type='button';b.className='green';b.textContent='Noise Filter: ON';
    b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();toggle()});
    controls.appendChild(b);
    updateButton();
  }

  window.isEaraNoiseFilterEnabled=enabled;
  window.applyEaraNoiseFilter=applyNoiseFilter;
  window.addEventListener('eara-media-ready',()=>{installButton();setTimeout(()=>applyNoiseFilter(false),30)});
  window.addEventListener('eara-mic-enabled',()=>setTimeout(()=>applyNoiseFilter(false),30));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')setTimeout(()=>applyNoiseFilter(false),100)});
  window.addEventListener('focus',()=>setTimeout(()=>applyNoiseFilter(false),100));
  installButton();
  setTimeout(()=>applyNoiseFilter(false),350);
})();
