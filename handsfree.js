// EARA persistent hands-free wake phrase: Hey Robot
(()=>{
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  let recognition=null,handsFree=false,speaking=false,starting=false,restartTimer=null,armedUntil=0;
  let player=null,voiceUnlocked=false,lastSpoken='';
  const setState=t=>{const e=document.querySelector('#state');if(e)e.textContent=t};
  const setTalk=t=>{const e=document.querySelector('#talk');if(e)e.textContent=t};
  function micAvailable(){return !!(window.getEaraStream?.()&&window.isEaraMicEnabled?.())}
  function ensurePlayer(){if(player)return player;player=document.createElement('audio');player.setAttribute('playsinline','');player.preload='auto';player.style.display='none';document.body.appendChild(player);return player}
  function scheduleRestart(delay=450){clearTimeout(restartTimer);if(!handsFree||speaking||!recognition||!micAvailable())return;restartTimer=setTimeout(()=>{if(!handsFree||speaking||starting||!micAvailable())return;try{starting=true;recognition.start()}catch(_){starting=false;scheduleRestart(1000)}},delay)}
  function setup(){if(!SR||recognition)return;recognition=new SR();recognition.continuous=false;recognition.interimResults=false;recognition.lang='en-US';recognition.maxAlternatives=1;
    recognition.onstart=()=>{starting=false;if(handsFree&&!speaking){setState('Listening — say “Hey Robot”');setTalk(voiceUnlocked?'Hey Robot Ready':'Tap Once for Voice + Hey Robot');try{badge(voiceUnlocked?'Hey Robot Ready':'Voice Tap Needed')}catch(_){}}};
    recognition.onresult=e=>{if(speaking)return;let heard='';for(let i=e.resultIndex;i<e.results.length;i++)heard+=e.results[i][0].transcript+' ';heard=heard.trim();if(!heard)return;const wake=heard.match(/\b(?:hey\s+)?robot\b[\s,.:;!?-]*(.*)$/i);let cmd='';if(wake){armedUntil=Date.now()+10000;cmd=(wake[1]||'').trim();if(!cmd){setState('Yes? I’m listening…');return}}else if(Date.now()<armedUntil)cmd=heard;else return;if(!cmd)return;armedUntil=0;try{recognition.abort()}catch(_){}setState('Thinking…');Promise.resolve(window.askAI?.(cmd)).catch(()=>{})};
    recognition.onerror=e=>{starting=false;if(e.error==='not-allowed'||e.error==='service-not-allowed'){handsFree=false;setState('Speech permission required.');setTalk('Enable Voice + Hey Robot');return}if(!speaking)scheduleRestart(e.error==='no-speech'?250:750)};
    recognition.onend=()=>{starting=false;if(handsFree&&!speaking)scheduleRestart(400)};
  }
  async function unlockVoice(announce=true){
    ensurePlayer();
    try{
      // iPhone requires a user gesture before later asynchronous audio playback.
      player.src='data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
      player.volume=0.01;await player.play();player.pause();player.currentTime=0;voiceUnlocked=true;player.volume=1;
    }catch(_){voiceUnlocked=true}
    setTalk('Hey Robot Ready');try{badge('Voice Ready')}catch(_){}
    if(announce)localSpeak('Voice ready');
    return true;
  }
  function localSpeak(text){
    try{speechSynthesis.cancel();speechSynthesis.resume();const u=new SpeechSynthesisUtterance(String(text||''));u.lang='en-US';u.volume=1;u.rate=1;const voices=speechSynthesis.getVoices();const v=voices.find(x=>/^en-US$/i.test(x.lang)&&/Samantha|Ava|Aaron|Alex|Siri/i.test(x.name))||voices.find(x=>/^en/i.test(x.lang));if(v)u.voice=v;speechSynthesis.speak(u);return true}catch(_){return false}
  }
  async function cloudSpeak(text){
    const msg=String(text||'').trim();if(!msg)return;lastSpoken=msg;
    speaking=true;clearTimeout(restartTimer);if(recognition){try{recognition.abort()}catch(_){}}
    setState('EARA speaking…');try{badge('Speaking')}catch(_){}
    try{
      const r=await fetch('https://eara-pwa.jesuscruz1984.workers.dev/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:msg}),cache:'no-store'});
      const raw=await r.text();if(!r.ok)throw new Error(raw);
      const j=JSON.parse(raw);if(!j.audio)throw new Error('No audio returned');
      const p=ensurePlayer();p.pause();p.src=`data:${j.mime||'audio/mpeg'};base64,${j.audio}`;p.volume=1;
      const done=()=>{speaking=false;if(handsFree&&micAvailable()){setState('Listening — say “Hey Robot”');scheduleRestart(650)}};
      p.onended=done;p.onerror=()=>{if(!localSpeak(msg)){setState('Tap Hey Robot Ready once to enable voice');setTalk('Tap Once for Voice + Hey Robot');try{badge('Voice Tap Needed')}catch(_){}}done()};
      try{await p.play();voiceUnlocked=true;setTalk('Hey Robot Ready')}catch(err){
        if(err?.name==='NotAllowedError'||/gesture|allowed|autoplay/i.test(String(err?.message||err))){
          speaking=false;setState('Tap Hey Robot Ready once to enable voice');setTalk('Tap Once for Voice + Hey Robot');try{badge('Voice Tap Needed')}catch(_){};if(handsFree&&micAvailable())scheduleRestart(650);return;
        }
        throw err;
      }
    }catch(e){
      const fallback=localSpeak(msg);speaking=false;
      if(fallback){setState('Listening — say “Hey Robot”');try{badge('Live')}catch(_){}}
      else{setState('Voice failed — tap Hey Robot Ready once');setTalk('Tap Once for Voice + Hey Robot');try{badge('Voice Tap Needed')}catch(_){}}
      if(handsFree&&micAvailable())scheduleRestart(650);
    }
  }
  window.say=cloudSpeak;window.unlockEaraVoice=()=>unlockVoice(true);
  function enable(){setup();if(!SR){setState('Hands-free recognition is not supported in this browser.');return}handsFree=true;setTalk(voiceUnlocked?'Hey Robot Ready':'Tap Once for Voice + Hey Robot');scheduleRestart(250)}
  function disable(){handsFree=false;clearTimeout(restartTimer);starting=false;if(recognition){try{recognition.abort()}catch(_){}}}
  window.addEventListener('eara-media-ready',enable);window.addEventListener('eara-mic-enabled',enable);window.addEventListener('eara-mic-disabled',disable);
  const talk=document.querySelector('#talk');if(talk)talk.addEventListener('click',async e=>{e.preventDefault();e.stopImmediatePropagation();if(!micAvailable())return;if(!voiceUnlocked){await unlockVoice(true);enable();setState('Listening — say “Hey Robot”');if(lastSpoken)setTimeout(()=>cloudSpeak(lastSpoken),700);return}if(handsFree){disable();setTalk('Resume Hey Robot');setState('Hands-free paused')}else enable()},true);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&handsFree&&!speaking)scheduleRestart(450)});
})();