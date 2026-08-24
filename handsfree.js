// EARA persistent hands-free wake phrase: Hey Robot
(()=>{
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  let recognition=null,handsFree=false,speaking=false,starting=false,restartTimer=null,armedUntil=0;
  let player=null,speakerEnabled=true,lastSpoken='',audioPrimed=false,speechErrorCount=0;

  const setState=t=>{const e=document.querySelector('#state');if(e)e.textContent=t};
  const setTalk=t=>{const e=document.querySelector('#talk');if(e)e.textContent=t};
  function micAvailable(){return !!(window.getEaraStream?.()&&window.isEaraMicEnabled?.())}
  function ensurePlayer(){
    if(player)return player;
    player=document.createElement('audio');
    player.setAttribute('playsinline','');
    player.preload='auto';
    player.style.display='none';
    document.body.appendChild(player);
    return player;
  }
  function updateSpeakerButton(){setTalk(speakerEnabled?'Speaker: ON':'Speaker: OFF')}

  function spokenVersion(text){
    const raw=String(text||'').trim();
    if(!raw)return '';
    const hadLink=/(?:https?:\/\/|www\.)/i.test(raw);
    let s=raw
      .replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)]+\)/gi,'$1')
      .replace(/(?:https?:\/\/|www\.)\S+/gi,'')
      .replace(/\b(?:direct\s+)?(?:amazon|product|purchase|buy|website)?\s*(?:link|url)\s*[:\-]?\s*/gi,'')
      .replace(/[\*_`#>|]+/g,' ')
      .replace(/\s+/g,' ')
      .trim();
    if(!s&&hadLink)return 'I found the link and put it on screen.';
    const sentences=s.match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[s];
    let short=sentences.slice(0,2).join(' ').trim();
    if(short.length>220){
      short=short.slice(0,220);
      const cut=short.lastIndexOf(' ');
      if(cut>155)short=short.slice(0,cut);
      short=short.replace(/[,:;\-\s]+$/,'')+'.';
    }
    if(hadLink&&!/\b(?:link|on screen|screen)\b/i.test(short)){
      short+=(/[.!?]$/.test(short)?'':' .')+' I found the link and put it on screen.';
    }
    return short.replace(/\s+\./g,'.').trim();
  }

  function scheduleRestart(delay=450){
    clearTimeout(restartTimer);
    if(!handsFree||speaking||!recognition||!micAvailable())return;
    const actual=Math.max(delay,Math.min(4500,speechErrorCount*700));
    restartTimer=setTimeout(()=>{
      if(!handsFree||speaking||starting||!micAvailable())return;
      try{
        starting=true;
        recognition.start();
      }catch(_){
        starting=false;
        speechErrorCount=Math.min(speechErrorCount+1,6);
        scheduleRestart(900);
      }
    },actual);
  }

  function setup(){
    if(!SR||recognition)return;
    recognition=new SR();
    recognition.continuous=false;
    recognition.interimResults=false;
    recognition.lang='en-US';
    recognition.maxAlternatives=1;

    recognition.onstart=()=>{
      starting=false;
      speechErrorCount=0;
      if(handsFree&&!speaking){
        setState('Listening — say “Hey Robot”');
        updateSpeakerButton();
        try{badge('Hey Robot Ready')}catch(_){}
      }
    };

    recognition.onresult=e=>{
      if(speaking)return;
      let heard='';
      for(let i=e.resultIndex;i<e.results.length;i++)heard+=e.results[i][0].transcript+' ';
      heard=heard.trim();
      if(!heard)return;

      const wake=heard.match(/\b(?:hey\s+)?robot\b[\s,.:;!?-]*(.*)$/i);
      let cmd='';
      if(wake){
        armedUntil=Date.now()+10000;
        cmd=(wake[1]||'').trim();
        if(!cmd){
          setState('Yes? I’m listening…');
          return;
        }
      }else if(Date.now()<armedUntil){
        cmd=heard;
      }else{
        return;
      }

      if(!cmd)return;
      armedUntil=0;
      try{recognition.abort()}catch(_){}
      setState('Thinking…');
      Promise.resolve(window.askAI?.(cmd))
        .catch(()=>{})
        .finally(()=>{
          if(handsFree&&!speaking&&micAvailable())scheduleRestart(650);
        });
    };

    recognition.onerror=e=>{
      starting=false;
      const err=String(e?.error||'');
      if(err==='not-allowed'||err==='service-not-allowed'){
        if(micAvailable()){
          speechErrorCount=Math.min(speechErrorCount+1,6);
          setState('Reconnecting listener…');
          try{badge('Listener reconnecting')}catch(_){}
          scheduleRestart(1200);
        }else{
          handsFree=false;
          setState('Microphone permission required.');
          try{badge('Mic Permission')}catch(_){}
        }
        return;
      }
      if(err==='audio-capture'&&!micAvailable()){
        setState('Microphone unavailable.');
        return;
      }
      speechErrorCount=Math.min(speechErrorCount+1,6);
      if(!speaking)scheduleRestart(err==='no-speech'?250:750);
    };

    recognition.onend=()=>{
      starting=false;
      if(handsFree&&!speaking)scheduleRestart(400);
    };
  }

  function localSpeak(text,onDone){
    if(!speakerEnabled)return false;
    const msg=spokenVersion(text);
    if(!msg)return false;
    try{
      speechSynthesis.cancel();
      speechSynthesis.resume();
      const u=new SpeechSynthesisUtterance(msg);
      u.lang='en-US';
      u.volume=1;
      u.rate=1;
      const voices=speechSynthesis.getVoices();
      const v=voices.find(x=>/^en-US$/i.test(x.lang)&&/Samantha|Ava|Aaron|Alex|Siri/i.test(x.name))
        ||voices.find(x=>/^en/i.test(x.lang));
      if(v)u.voice=v;
      let finished=false;
      const finish=()=>{
        if(finished)return;
        finished=true;
        if(typeof onDone==='function')onDone();
      };
      u.onend=finish;
      u.onerror=finish;
      speechSynthesis.speak(u);
      return true;
    }catch(_){
      return false;
    }
  }

  async function primeAudio(){
    if(!speakerEnabled)return false;
    const p=ensurePlayer();
    try{
      p.src='data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
      p.volume=0.01;
      await p.play();
      p.pause();
      p.currentTime=0;
      p.volume=1;
      audioPrimed=true;
      return true;
    }catch(_){
      return false;
    }
  }

  async function cloudSpeak(text){
    const full=String(text||'').trim();
    const msg=spokenVersion(full);
    if(!msg||!speakerEnabled)return;
    lastSpoken=full;
    speaking=true;
    clearTimeout(restartTimer);
    if(recognition){try{recognition.abort()}catch(_){} }
    setState('EARA speaking…');
    try{badge('Speaking')}catch(_){}

    const done=()=>{
      speaking=false;
      if(handsFree&&micAvailable()){
        setState('Listening — say “Hey Robot”');
        scheduleRestart(700);
      }
    };

    try{
      const r=await fetch('https://eara-pwa.jesuscruz1984.workers.dev/tts',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({text:msg,speaker:window.getEaraVoice?.()||'asteria'}),
        cache:'no-store'
      });
      const raw=await r.text();
      if(!r.ok)throw new Error(raw);
      const j=JSON.parse(raw);
      if(!j.audio)throw new Error('No audio returned');

      const p=ensurePlayer();
      p.pause();
      p.src=`data:${j.mime||'audio/mpeg'};base64,${j.audio}`;
      p.volume=1;
      p.onended=done;
      p.onerror=()=>{
        if(!localSpeak(msg,done))done();
      };

      try{
        await p.play();
        audioPrimed=true;
      }catch(_){
        if(!localSpeak(msg,done))done();
      }
    }catch(_){
      const usedLocal=localSpeak(msg,done);
      if(!usedLocal){
        speaking=false;
        setState(audioPrimed?'Voice playback failed — tap Speak Again':'iPhone blocked automatic audio. Tap anywhere once to unlock speaker.');
        try{badge(audioPrimed?'Voice Error':'Audio Tap Needed')}catch(_){}
        if(handsFree&&micAvailable())scheduleRestart(700);
      }
    }
  }

  window.say=cloudSpeak;
  window.unlockEaraVoice=()=>primeAudio();
  window.isEaraSpeakerEnabled=()=>speakerEnabled;
  window.getEaraSpokenVersion=spokenVersion;

  function enable(){
    setup();
    if(!SR){
      setState('Hands-free recognition is not supported in this browser.');
      return;
    }
    handsFree=true;
    speechErrorCount=0;
    updateSpeakerButton();
    scheduleRestart(200);
    primeAudio();
  }

  function disable(){
    handsFree=false;
    clearTimeout(restartTimer);
    starting=false;
    if(recognition){try{recognition.abort()}catch(_){} }
  }

  function recoverListening(){
    if(!micAvailable())return;
    setup();
    handsFree=true;
    speechErrorCount=0;
    if(!speaking)scheduleRestart(100);
  }

  window.forceEaraListening=recoverListening;
  window.addEventListener('eara-media-ready',enable);
  window.addEventListener('eara-mic-enabled',enable);
  window.addEventListener('eara-mic-disabled',disable);

  const talk=document.querySelector('#talk');
  if(talk)talk.addEventListener('click',async e=>{
    e.preventDefault();
    e.stopImmediatePropagation();
    speakerEnabled=!speakerEnabled;
    updateSpeakerButton();
    if(!speakerEnabled){
      if(player){try{player.pause()}catch(_){} }
      try{speechSynthesis.cancel()}catch(_){}
      setState(handsFree?'Listening — speaker off':'Speaker off');
      try{badge('Speaker Off')}catch(_){}
      recoverListening();
    }else{
      await primeAudio();
      recoverListening();
      setState(handsFree?'Listening — say “Hey Robot”':'Speaker on');
      try{badge('Live')}catch(_){}
    }
  },true);

  document.addEventListener('pointerdown',()=>{
    if(speakerEnabled&&!audioPrimed)primeAudio();
    recoverListening();
  },{capture:true});

  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible'){
      recoverListening();
      if(speakerEnabled)primeAudio();
    }
  });

  window.addEventListener('focus',recoverListening);
  updateSpeakerButton();
})();
