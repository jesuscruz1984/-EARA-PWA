// EARA persistent hands-free wake phrase: Eara
(()=>{
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  const WAKE=/^\s*(?:(?:hey|ok|okay)\s+)?(?:eara|era|aira|eira|eera|ear\s+a)\b[\s,.:;!?-]*(.*)$/i;
  const ACTIVE_MS=10000;
  const COMMAND_SILENCE_MS=950;

  let recognition=null,handsFree=false,speaking=false,processing=false,starting=false;
  let restartTimer=null,activeTimer=null,commandTimer=null,activeUntil=0,active=false,commandBuffer='';
  let player=null,speakerEnabled=true,lastSpoken='',audioPrimed=false,speechErrorCount=0;

  const setState=t=>{const e=document.querySelector('#state');if(e)e.textContent=t};
  const setTalk=t=>{const e=document.querySelector('#talk');if(e)e.textContent=t};
  const setBadge=t=>{try{badge(t)}catch(_){}};
  function micAvailable(){return !!(window.getEaraStream?.()&&window.isEaraMicEnabled?.())}
  function ensurePlayer(){if(player)return player;player=document.createElement('audio');player.setAttribute('playsinline','');player.preload='auto';player.style.display='none';document.body.appendChild(player);return player}
  function updateSpeakerButton(){setTalk(speakerEnabled?'Speaker: ON':'Speaker: OFF')}
  function idleState(){return active?'Eara active — keep talking':'Listening for “Eara”'}
  function idleBadge(){return active?'Eara Active':'Eara Ready'}

  function spokenVersion(text){
    const raw=String(text||'').trim();if(!raw)return '';
    const hadLink=/(?:https?:\/\/|www\.)/i.test(raw);
    let s=raw.replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)]+\)/gi,'$1').replace(/(?:https?:\/\/|www\.)\S+/gi,'').replace(/\b(?:direct\s+)?(?:amazon|product|purchase|buy|website)?\s*(?:link|url)\s*[:\-]?\s*/gi,'').replace(/[\*_`#>|]+/g,' ').replace(/\s+/g,' ').trim();
    if(!s&&hadLink)return 'I found the link and put it on screen.';
    const sentences=s.match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[s];
    let short=sentences.slice(0,2).join(' ').trim();
    if(short.length>220){short=short.slice(0,220);const cut=short.lastIndexOf(' ');if(cut>155)short=short.slice(0,cut);short=short.replace(/[,:;\-\s]+$/,'')+'.'}
    if(hadLink&&!/\b(?:link|on screen|screen)\b/i.test(short))short+=(/[.!?]$/.test(short)?'':' .')+' I found the link and put it on screen.';
    return short.replace(/\s+\./g,'.').trim();
  }

  function clearActiveTimer(){clearTimeout(activeTimer);activeTimer=null}
  function armActive(){
    active=true;activeUntil=Date.now()+ACTIVE_MS;clearActiveTimer();
    activeTimer=setTimeout(checkActiveTimeout,ACTIVE_MS+80);
    if(!speaking&&!processing){setState(idleState());setBadge(idleBadge())}
  }
  function checkActiveTimeout(){
    if(!active)return;
    const remain=activeUntil-Date.now();
    if(remain>0){activeTimer=setTimeout(checkActiveTimeout,remain+80);return}
    if(speaking||processing){activeUntil=Date.now()+1500;activeTimer=setTimeout(checkActiveTimeout,1600);return}
    active=false;commandBuffer='';clearTimeout(commandTimer);commandTimer=null;
    setState('Listening for “Eara”');setBadge('Eara Ready');
  }

  function appendCommand(segment){
    const s=String(segment||'').trim();if(!s)return;
    armActive();
    if(!commandBuffer)commandBuffer=s;
    else if(!commandBuffer.toLowerCase().endsWith(s.toLowerCase()))commandBuffer+=' '+s;
    clearTimeout(commandTimer);
    commandTimer=setTimeout(submitCommand,COMMAND_SILENCE_MS);
    setState('Eara active — listening…');setBadge('Eara Active');
  }

  function submitCommand(){
    clearTimeout(commandTimer);commandTimer=null;
    if(!commandBuffer||processing||speaking){if(commandBuffer)commandTimer=setTimeout(submitCommand,350);return}
    const cmd=commandBuffer.trim();commandBuffer='';if(!cmd)return;
    processing=true;armActive();
    try{recognition?.abort()}catch(_){}
    setState('Thinking…');setBadge('Thinking');
    Promise.resolve(window.askAI?.(cmd)).catch(()=>{}).finally(()=>{
      processing=false;
      if(active)armActive();
      if(handsFree&&!speaking&&micAvailable())scheduleRestart(160);
    });
  }

  function scheduleRestart(delay=240){
    clearTimeout(restartTimer);
    if(!handsFree||speaking||processing||!recognition||!micAvailable())return;
    const backoff=Math.min(2600,speechErrorCount*350);
    restartTimer=setTimeout(()=>{
      if(!handsFree||speaking||processing||starting||!micAvailable())return;
      try{starting=true;recognition.start()}catch(_){starting=false;speechErrorCount=Math.min(speechErrorCount+1,6);scheduleRestart(450)}
    },Math.max(delay,backoff));
  }

  function pickTranscript(result){
    if(!result)return '';
    if(!active){for(let i=0;i<Math.min(result.length,3);i++){const t=String(result[i]?.transcript||'').trim();if(WAKE.test(t))return t}}
    return String(result[0]?.transcript||'').trim();
  }

  function setup(){
    if(!SR||recognition)return;
    recognition=new SR();recognition.continuous=false;recognition.interimResults=true;recognition.lang='en-US';recognition.maxAlternatives=3;
    recognition.onstart=()=>{starting=false;speechErrorCount=0;if(handsFree&&!speaking&&!processing){setState(idleState());updateSpeakerButton();setBadge(idleBadge())}};
    recognition.onresult=e=>{
      if(speaking||processing)return;
      for(let i=e.resultIndex;i<e.results.length;i++){
        const res=e.results[i];const heard=pickTranscript(res);if(!heard)continue;
        const wake=heard.match(WAKE);
        if(wake){
          armActive();
          if(!res.isFinal){setState('Eara heard — I’m listening…');continue}
          const rest=String(wake[1]||'').trim();if(rest)appendCommand(rest);else{setState('Yes? I’m listening…');setBadge('Eara Active')}
          continue;
        }
        if(!active)continue;
        armActive();
        if(res.isFinal)appendCommand(heard);else{setState('Eara active — listening…');setBadge('Eara Active')}
      }
    };
    recognition.onerror=e=>{
      starting=false;const err=String(e?.error||'');
      if(err==='not-allowed'||err==='service-not-allowed'){
        if(micAvailable()){speechErrorCount=Math.min(speechErrorCount+1,6);setState('Reconnecting listener…');setBadge('Listener reconnecting');scheduleRestart(700)}
        else{handsFree=false;setState('Microphone permission required.');setBadge('Mic Permission')}
        return;
      }
      if(err==='audio-capture'&&!micAvailable()){setState('Microphone unavailable.');return}
      speechErrorCount=Math.min(speechErrorCount+1,6);if(!speaking&&!processing)scheduleRestart(err==='no-speech'?120:400);
    };
    recognition.onend=()=>{starting=false;if(handsFree&&!speaking&&!processing)scheduleRestart(active?100:220)};
  }

  function localSpeak(text,onDone){
    if(!speakerEnabled)return false;const msg=spokenVersion(text);if(!msg)return false;
    try{speechSynthesis.cancel();speechSynthesis.resume();const u=new SpeechSynthesisUtterance(msg);u.lang='en-US';u.volume=1;u.rate=1;const voices=speechSynthesis.getVoices();const v=voices.find(x=>/^en-US$/i.test(x.lang)&&/Samantha|Ava|Aaron|Alex|Siri/i.test(x.name))||voices.find(x=>/^en/i.test(x.lang));if(v)u.voice=v;let finished=false;const finish=()=>{if(finished)return;finished=true;if(typeof onDone==='function')onDone()};u.onend=finish;u.onerror=finish;speechSynthesis.speak(u);return true}catch(_){return false}
  }

  async function primeAudio(){
    if(!speakerEnabled)return false;const p=ensurePlayer();
    try{p.src='data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';p.volume=0.01;await p.play();p.pause();p.currentTime=0;p.volume=1;audioPrimed=true;return true}catch(_){return false}
  }

  async function cloudSpeak(text){
    const full=String(text||'').trim();const msg=spokenVersion(full);if(!msg||!speakerEnabled){if(active)armActive();if(handsFree&&micAvailable())scheduleRestart(120);return}
    lastSpoken=full;speaking=true;clearTimeout(restartTimer);try{recognition?.abort()}catch(_){}setState('EARA speaking…');setBadge('Speaking');
    const done=()=>{speaking=false;if(active)armActive();if(handsFree&&micAvailable()){setState(idleState());setBadge(idleBadge());scheduleRestart(140)}};
    try{
      const r=await fetch('https://eara-pwa.jesuscruz1984.workers.dev/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:msg,speaker:window.getEaraVoice?.()||'asteria'}),cache:'no-store'});
      const raw=await r.text();if(!r.ok)throw new Error(raw);const j=JSON.parse(raw);if(!j.audio)throw new Error('No audio returned');
      const p=ensurePlayer();p.pause();p.src=`data:${j.mime||'audio/mpeg'};base64,${j.audio}`;p.volume=1;p.onended=done;p.onerror=()=>{if(!localSpeak(msg,done))done()};
      try{await p.play();audioPrimed=true}catch(_){if(!localSpeak(msg,done))done()}
    }catch(_){const usedLocal=localSpeak(msg,done);if(!usedLocal){speaking=false;setState(audioPrimed?'Voice playback failed — tap Speak Again':'iPhone blocked automatic audio. Tap anywhere once to unlock speaker.');setBadge(audioPrimed?'Voice Error':'Audio Tap Needed');if(handsFree&&micAvailable())scheduleRestart(180)}}
  }

  window.say=cloudSpeak;window.unlockEaraVoice=()=>primeAudio();window.isEaraSpeakerEnabled=()=>speakerEnabled;window.getEaraSpokenVersion=spokenVersion;
  window.isEaraActive=()=>active;

  function enable(){setup();if(!SR){setState('Hands-free recognition is not supported in this browser.');return}handsFree=true;speechErrorCount=0;updateSpeakerButton();scheduleRestart(80);primeAudio()}
  function disable(){handsFree=false;clearTimeout(restartTimer);clearTimeout(commandTimer);clearActiveTimer();starting=false;active=false;commandBuffer='';try{recognition?.abort()}catch(_){} }
  function recoverListening(){if(!micAvailable())return;setup();handsFree=true;speechErrorCount=0;if(!speaking&&!processing)scheduleRestart(60)}

  window.forceEaraListening=recoverListening;
  window.addEventListener('eara-media-ready',enable);window.addEventListener('eara-mic-enabled',enable);window.addEventListener('eara-mic-disabled',disable);

  const talk=document.querySelector('#talk');
  if(talk)talk.addEventListener('click',async e=>{e.preventDefault();e.stopImmediatePropagation();speakerEnabled=!speakerEnabled;updateSpeakerButton();if(!speakerEnabled){if(player){try{player.pause()}catch(_){}}try{speechSynthesis.cancel()}catch(_){}setState(active?'Eara active — speaker off':'Listening for “Eara”');setBadge('Speaker Off');recoverListening()}else{await primeAudio();recoverListening();setState(idleState());setBadge(idleBadge())}},true);

  document.addEventListener('pointerdown',()=>{if(speakerEnabled&&!audioPrimed)primeAudio();recoverListening()},{capture:true});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){recoverListening();if(speakerEnabled)primeAudio()}});
  window.addEventListener('focus',recoverListening);
  updateSpeakerButton();
})();
