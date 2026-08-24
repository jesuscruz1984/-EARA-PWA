// EARA hands-free wake mode — persistent wake phrase: Hey Robot
(() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null, handsFree = false, speaking = false, starting = false;
  let armedUntil = 0, restartTimer = null, speechTimer = null;

  function setState(text){ const el=document.querySelector('#state'); if(el) el.textContent=text; }
  function setTalk(text){ const el=document.querySelector('#talk'); if(el) el.textContent=text; }
  function scheduleRestart(delay=500){
    clearTimeout(restartTimer);
    if(!handsFree || speaking || !recognition) return;
    restartTimer=setTimeout(()=>{
      if(!handsFree || speaking || starting) return;
      try { starting=true; recognition.start(); }
      catch(_) { starting=false; scheduleRestart(1200); }
    },delay);
  }

  function setupRecognition(){
    if(!SR || recognition) return;
    recognition=new SR(); recognition.continuous=false; recognition.interimResults=false;
    recognition.lang='en-US'; recognition.maxAlternatives=1;
    recognition.onstart=()=>{ starting=false; if(handsFree&&!speaking){setState('Listening — say “Hey Robot”');setTalk('Hey Robot Ready');try{badge('Hey Robot Ready')}catch(_){}} };
    recognition.onresult=(event)=>{
      if(speaking) return;
      let heard=''; for(let i=event.resultIndex;i<event.results.length;i++) heard+=event.results[i][0].transcript+' ';
      heard=heard.trim(); if(!heard)return;
      const wake=heard.match(/\b(?:hey\s+)?robot\b[\s,.:;!?-]*(.*)$/i); let command='';
      if(wake){armedUntil=Date.now()+10000;command=(wake[1]||'').trim();if(!command){setState('Yes? I’m listening…');return;}}
      else if(Date.now()<armedUntil) command=heard; else return;
      if(!command)return; armedUntil=0;
      const tr=document.querySelector('#transcript');if(tr)tr.textContent='You: '+command;
      setState('Thinking…'); try{recognition.abort()}catch(_){}
      Promise.resolve(askAI(command)).catch(()=>{});
    };
    recognition.onerror=(e)=>{starting=false;if(e.error==='not-allowed'||e.error==='service-not-allowed'){handsFree=false;setState('Microphone speech permission is required.');setTalk('Resume Hey Robot');return;}if(!speaking)scheduleRestart(e.error==='no-speech'?300:900);};
    recognition.onend=()=>{starting=false;if(handsFree&&!speaking)scheduleRestart(500);};
  }

  // iPhone Safari needs speech started from a user-unlocked speechSynthesis session.
  function unlockSpeech(){
    try{
      speechSynthesis.cancel();
      const u=new SpeechSynthesisUtterance(' '); u.volume=0; u.rate=1;
      speechSynthesis.speak(u);
    }catch(_){}
  }

  say=function(text){
    const msg=String(text||'').trim(); if(!msg)return;
    speaking=true; clearTimeout(restartTimer); clearTimeout(speechTimer);
    if(recognition){try{recognition.abort()}catch(_){}}
    try{speechSynthesis.cancel(); speechSynthesis.resume();}catch(_){}
    const u=new SpeechSynthesisUtterance(msg);
    u.volume=1; u.rate=1; u.pitch=1; u.lang='en-US';
    try{
      const voices=speechSynthesis.getVoices();
      const v=voices.find(x=>/^en-US$/i.test(x.lang)&&/Samantha|Siri|Ava|Aaron|Alex/i.test(x.name)) || voices.find(x=>/^en/i.test(x.lang));
      if(v)u.voice=v;
    }catch(_){}
    let finished=false;
    const done=()=>{if(finished)return;finished=true;clearTimeout(speechTimer);speaking=false;setState('Listening — say “Hey Robot”');scheduleRestart(700);};
    u.onstart=()=>{setState('EARA speaking…');try{badge('Speaking')}catch(_){}};
    u.onend=done;u.onerror=done;
    // Short delay after aborting recognition prevents WebKit audio-session collision.
    setTimeout(()=>{
      try{speechSynthesis.resume();speechSynthesis.speak(u);}catch(_){done();}
      const words=msg.split(/\s+/).length;
      speechTimer=setTimeout(done,Math.max(7000,Math.min(40000,words*700+4000)));
    },450);
  };

  function enableHandsFree(){setupRecognition();if(!SR){setState('Hands-free speech recognition is not supported in this browser.');return;}unlockSpeech();handsFree=true;setTalk('Hey Robot Ready');scheduleRestart(350);}
  function disableHandsFree(){handsFree=false;clearTimeout(restartTimer);starting=false;if(recognition){try{recognition.abort()}catch(_){}}}

  const startButton=document.querySelector('#start');
  if(startButton)startButton.addEventListener('click',()=>{unlockSpeech();setTimeout(()=>{if(typeof stream!=='undefined'&&stream)enableHandsFree();else disableHandsFree();},700);});
  const talkButton=document.querySelector('#talk');
  if(talkButton){talkButton.textContent='Hey Robot Ready';talkButton.addEventListener('click',(e)=>{e.preventDefault();e.stopImmediatePropagation();unlockSpeech();if(!stream)return;if(handsFree){disableHandsFree();setTalk('Resume Hey Robot');setState('Hands-free paused');}else enableHandsFree();},true);}
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&handsFree&&!speaking)scheduleRestart(500);});
})();