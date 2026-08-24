// EARA hands-free wake mode — persistent wake phrase: Hey Robot
(() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let handsFree = false;
  let speaking = false;
  let starting = false;
  let armedUntil = 0;
  let restartTimer = null;

  function setState(text){ const el=document.querySelector('#state'); if(el) el.textContent=text; }
  function setTalk(text){ const el=document.querySelector('#talk'); if(el) el.textContent=text; }

  function scheduleRestart(delay=350){
    clearTimeout(restartTimer);
    if(!handsFree || speaking || !recognition) return;
    restartTimer=setTimeout(()=>{
      if(!handsFree || speaking || starting) return;
      try { starting=true; recognition.start(); }
      catch(_) { starting=false; scheduleRestart(900); }
    },delay);
  }

  function setupRecognition(){
    if(!SR || recognition) return;
    recognition=new SR();
    // iOS/WebKit often ends a recognition session after a phrase even with continuous=true.
    // onend below deliberately creates a fresh listening session every time.
    recognition.continuous=false;
    recognition.interimResults=false;
    recognition.lang='en-US';
    recognition.maxAlternatives=1;

    recognition.onstart=()=>{
      starting=false;
      if(handsFree&&!speaking){setState('Listening — say “Hey Robot”');setTalk('Hey Robot Ready');try{badge('Hey Robot Ready')}catch(_){}}
    };

    recognition.onresult=(event)=>{
      if(speaking) return;
      let heard='';
      for(let i=event.resultIndex;i<event.results.length;i++) heard += event.results[i][0].transcript+' ';
      heard=heard.trim();
      if(!heard) return;

      const wake=heard.match(/\b(?:hey\s+)?robot\b[\s,.:;!?-]*(.*)$/i);
      let command='';
      if(wake){
        armedUntil=Date.now()+10000;
        command=(wake[1]||'').trim();
        if(!command){setState('Yes? I’m listening…');return;}
      } else if(Date.now()<armedUntil){
        command=heard;
      } else {
        return;
      }

      if(!command) return;
      armedUntil=0;
      const tr=document.querySelector('#transcript'); if(tr) tr.textContent='You: '+command;
      setState('Thinking…');
      try{recognition.abort()}catch(_){}
      Promise.resolve(askAI(command)).catch(()=>{});
    };

    recognition.onerror=(e)=>{
      starting=false;
      if(e.error==='not-allowed'||e.error==='service-not-allowed'){
        handsFree=false; setState('Microphone speech permission is required.'); setTalk('Resume Hey Robot'); return;
      }
      // aborted is expected while EARA is answering; all temporary errors recover automatically.
      if(!speaking) scheduleRestart(e.error==='no-speech'?150:650);
    };

    recognition.onend=()=>{
      starting=false;
      if(handsFree&&!speaking) scheduleRestart(180);
    };
  }

  // Replace page TTS so recognition cannot hear EARA's own voice and always resumes afterward.
  say=function(text){
    speaking=true;
    clearTimeout(restartTimer);
    if(recognition){try{recognition.abort()}catch(_){}}
    speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(text);
    let finished=false;
    const done=()=>{
      if(finished)return; finished=true;
      speaking=false;
      setState('Listening — say “Hey Robot”');
      scheduleRestart(250);
    };
    u.onend=done; u.onerror=done;
    speechSynthesis.speak(u);
    // WebKit occasionally fails to fire onend; recover instead of leaving wake mode dead.
    const words=String(text||'').trim().split(/\s+/).filter(Boolean).length;
    setTimeout(()=>{if(speaking)done()},Math.max(5000,Math.min(30000,words*650+2500)));
  };

  function enableHandsFree(){
    setupRecognition();
    if(!SR){setState('Hands-free speech recognition is not supported in this browser.');return;}
    handsFree=true; setTalk('Hey Robot Ready'); scheduleRestart(100);
  }
  function disableHandsFree(){
    handsFree=false; clearTimeout(restartTimer); starting=false;
    if(recognition){try{recognition.abort()}catch(_){}}
  }

  const startButton=document.querySelector('#start');
  if(startButton)startButton.addEventListener('click',()=>setTimeout(()=>{
    if(typeof stream!=='undefined'&&stream) enableHandsFree(); else disableHandsFree();
  },700));

  const talkButton=document.querySelector('#talk');
  if(talkButton){
    talkButton.textContent='Hey Robot Ready';
    talkButton.addEventListener('click',(e)=>{
      e.preventDefault(); e.stopImmediatePropagation();
      if(!stream)return;
      if(handsFree){disableHandsFree();setTalk('Resume Hey Robot');setState('Hands-free paused');}
      else enableHandsFree();
    },true);
  }

  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible'&&handsFree&&!speaking) scheduleRestart(250);
  });
})();