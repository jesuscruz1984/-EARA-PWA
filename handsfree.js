// EARA persistent hands-free wake phrase: Hey Robot
(()=>{
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  let recognition=null,handsFree=false,speaking=false,starting=false,restartTimer=null,armedUntil=0;
  let player=null,speakerEnabled=true,lastSpoken='';
  const setState=t=>{const e=document.querySelector('#state');if(e)e.textContent=t};
  const setTalk=t=>{const e=document.querySelector('#talk');if(e)e.textContent=t};
  function micAvailable(){return !!(window.getEaraStream?.()&&window.isEaraMicEnabled?.())}
  function ensurePlayer(){if(player)return player;player=document.createElement('audio');player.setAttribute('playsinline','');player.preload='auto';player.style.display='none';document.body.appendChild(player);return player}
  function updateSpeakerButton(){setTalk(speakerEnabled?'Speaker: ON':'Speaker: OFF')}
  function scheduleRestart(delay=450){clearTimeout(restartTimer);if(!handsFree||speaking||!recognition||!micAvailable())return;restartTimer=setTimeout(()=>{if(!handsFree||speaking||starting||!micAvailable())return;try{starting=true;recognition.start()}catch(_){starting=false;scheduleRestart(1000)}},delay)}
  function setup(){if(!SR||recognition)return;recognition=new SR();recognition.continuous=false;recognition.interimResults=false;recognition.lang='en-US';recognition.maxAlternatives=1;
    recognition.onstart=()=>{starting=false;if(handsFree&&!speaking){setState('Listening — say “Hey Robot”');updateSpeakerButton();try{badge('Hey Robot Ready')}catch(_){}}};
    recognition.onresult=e=>{if(speaking)return;let heard='';for(let i=e.resultIndex;i<e.results.length;i++)heard+=e.results[i][0].transcript+' ';heard=heard.trim();if(!heard)return;const wake=heard.match(/\b(?:hey\s+)?robot\b[\s,.:;!?-]*(.*)$/i);let cmd='';if(wake){armedUntil=Date.now()+10000;cmd=(wake[1]||'').trim();if(!cmd){setState('Yes? I’m listening…');return}}else if(Date.now()<armedUntil)cmd=heard;else return;if(!cmd)return;armedUntil=0;try{recognition.abort()}catch(_){}setState('Thinking…');Promise.resolve(window.askAI?.(cmd)).catch(()=>{})};
    recognition.onerror=e=>{starting=false;if(e.error==='not-allowed'||e.error==='service-not-allowed'){handsFree=false;setState('Speech permission required.');return}if(!speaking)scheduleRestart(e.error==='no-speech'?250:750)};
    recognition.onend=()=>{starting=false;if(handsFree&&!speaking)scheduleRestart(400)};
  }
  function localSpeak(text){
    if(!speakerEnabled)return false;
    try{speechSynthesis.cancel();speechSynthesis.resume();const u=new SpeechSynthesisUtterance(String(text||''));u.lang='en-US';u.volume=1;u.rate=1;const voices=speechSynthesis.getVoices();const v=voices.find(x=>/^en-US$/i.test(x.lang)&&/Samantha|Ava|Aaron|Alex|Siri/i.test(x.name))||voices.find(x=>/^en/i.test(x.lang));if(v)u.voice=v;speechSynthesis.speak(u);return true}catch(_){return false}
  }
  async function primeAudio(){
    if(!speakerEnabled)return;
    const p=ensurePlayer();
    try{p.src='data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';p.volume=0.01;await p.play();p.pause();p.currentTime=0;p.volume=1}catch(_){}
  }
  async function cloudSpeak(text){
    const msg=String(text||'').trim();if(!msg||!speakerEnabled)return;lastSpoken=msg;
    speaking=true;clearTimeout(restartTimer);if(recognition){try{recognition.abort()}catch(_){}}
    setState('EARA speaking…');try{badge('Speaking')}catch(_){}
    try{
      const r=await fetch('https://eara-pwa.jesuscruz1984.workers.dev/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:msg}),cache:'no-store'});
      const raw=await r.text();if(!r.ok)throw new Error(raw);
      const j=JSON.parse(raw);if(!j.audio)throw new Error('No audio returned');
      const p=ensurePlayer();p.pause();p.src=`data:${j.mime||'audio/mpeg'};base64,${j.audio}`;p.volume=1;
      const done=()=>{speaking=false;if(handsFree&&micAvailable()){setState('Listening — say “Hey Robot”');scheduleRestart(650)}};
      p.onended=done;p.onerror=()=>{localSpeak(msg);done()};
      try{await p.play()}catch(_){if(localSpeak(msg)){done();return}throw _}
    }catch(_){
      const fallback=localSpeak(msg);speaking=false;
      if(fallback){setState('Listening — say “Hey Robot”');try{badge('Live')}catch(_){}}
      else{setState('Speaker is on, but iPhone blocked playback. Tap Speaker OFF then ON once.');try{badge('Audio Blocked')}catch(_){}}
      if(handsFree&&micAvailable())scheduleRestart(650);
    }
  }
  window.say=cloudSpeak;
  window.unlockEaraVoice=()=>primeAudio();
  window.isEaraSpeakerEnabled=()=>speakerEnabled;
  function enable(){setup();if(!SR){setState('Hands-free recognition is not supported in this browser.');return}handsFree=true;updateSpeakerButton();scheduleRestart(250);primeAudio()}
  function disable(){handsFree=false;clearTimeout(restartTimer);starting=false;if(recognition){try{recognition.abort()}catch(_){}}}
  window.addEventListener('eara-media-ready',enable);window.addEventListener('eara-mic-enabled',enable);window.addEventListener('eara-mic-disabled',disable);
  const talk=document.querySelector('#talk');if(talk)talk.addEventListener('click',async e=>{e.preventDefault();e.stopImmediatePropagation();speakerEnabled=!speakerEnabled;updateSpeakerButton();if(!speakerEnabled){if(player){try{player.pause()}catch(_){}}try{speechSynthesis.cancel()}catch(_){};setState(handsFree?'Listening — speaker off':'Speaker off');try{badge('Speaker Off')}catch(_){}}else{await primeAudio();localSpeak('Speaker on');setState(handsFree?'Listening — say “Hey Robot”':'Speaker on');try{badge('Live')}catch(_){}}},true);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){if(handsFree&&!speaking)scheduleRestart(450);if(speakerEnabled)primeAudio()}});
  updateSpeakerButton();
})();