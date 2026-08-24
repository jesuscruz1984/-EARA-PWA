// EARA hands-free wake mode — wake phrase: Hey Robot
(() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let handsFree = false;
  let speaking = false;
  let restarting = false;
  let armedUntil = 0;

  function setState(text){ const el=document.querySelector('#state'); if(el) el.textContent=text; }
  function restartSoon(delay=300){
    if(!handsFree || speaking || !recognition || restarting) return;
    restarting=true;
    setTimeout(()=>{restarting=false;if(!handsFree||speaking)return;try{recognition.start()}catch(_){setTimeout(()=>restartSoon(700),750)}},delay);
  }
  function setupRecognition(){
    if(!SR || recognition) return;
    recognition=new SR(); recognition.continuous=true; recognition.interimResults=true; recognition.lang='en-US';
    recognition.onstart=()=>{if(handsFree&&!speaking){setState('Listening — say “Hey Robot”');try{badge('Hey Robot Ready')}catch(_){}}};
    recognition.onresult=(event)=>{
      if(speaking) return;
      let heard='';
      for(let i=event.resultIndex;i<event.results.length;i++) heard += event.results[i][0].transcript+' ';
      heard=heard.trim(); if(!heard)return;
      const wake=heard.match(/\b(?:hey\s+)?robot\b[\s,.:;!?-]*(.*)$/i);
      let command='';
      if(wake){armedUntil=Date.now()+8000;command=(wake[1]||'').trim();if(!command){setState('Yes? I’m listening…');return;}}
      else if(Date.now()<armedUntil){command=heard.trim();}
      else return;
      if(!command)return;
      armedUntil=0;
      const tr=document.querySelector('#transcript');if(tr)tr.textContent='You: '+command;
      try{recognition.stop()}catch(_){}
      setState('Thinking…');
      Promise.resolve(askAI(command)).finally(()=>{if(!speaking)restartSoon(500)});
    };
    recognition.onerror=(e)=>{
      if(e.error==='not-allowed'||e.error==='service-not-allowed'){handsFree=false;setState('Microphone speech permission is required.');return;}
      restartSoon(e.error==='no-speech'?250:800);
    };
    recognition.onend=()=>restartSoon(250);
  }
  const baseSay=say;
  say=function(text){
    speaking=true;
    if(recognition){try{recognition.stop()}catch(_){}}
    speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(text);
    const done=()=>{speaking=false;restartSoon(350)};
    u.onend=done;u.onerror=done;speechSynthesis.speak(u);
  };
  function enableHandsFree(){setupRecognition();if(!SR){setState('Hands-free speech recognition is not supported in this browser.');return;}handsFree=true;restartSoon(100);}
  function disableHandsFree(){handsFree=false;if(recognition){try{recognition.stop()}catch(_){}}}
  const startButton=document.querySelector('#start');
  if(startButton)startButton.addEventListener('click',()=>setTimeout(()=>{if(typeof stream!=='undefined'&&stream)enableHandsFree();else disableHandsFree()},700));
  const talkButton=document.querySelector('#talk');
  if(talkButton){
    talkButton.textContent='Hey Robot Ready';
    talkButton.addEventListener('click',(e)=>{e.preventDefault();e.stopImmediatePropagation();if(!stream)return;handsFree=!handsFree;if(handsFree){talkButton.textContent='Hey Robot Ready';enableHandsFree()}else{talkButton.textContent='Resume Hey Robot';disableHandsFree();setState('Hands-free paused')}},true);
  }
})();