// EARA persistent hands-free wake phrase: Hey Robot
(()=>{
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  let recognition=null,handsFree=false,speaking=false,starting=false,restartTimer=null,speechTimer=null,armedUntil=0,voiceUnlocked=false;
  const setState=t=>{const e=document.querySelector('#state');if(e)e.textContent=t};
  const setTalk=t=>{const e=document.querySelector('#talk');if(e)e.textContent=t};
  function micAvailable(){return !!(window.getEaraStream?.()&&window.isEaraMicEnabled?.())}
  function scheduleRestart(delay=450){clearTimeout(restartTimer);if(!handsFree||speaking||!recognition||!micAvailable())return;restartTimer=setTimeout(()=>{if(!handsFree||speaking||starting||!micAvailable())return;try{starting=true;recognition.start()}catch(_){starting=false;scheduleRestart(1000)}},delay)}
  function setup(){if(!SR||recognition)return;recognition=new SR();recognition.continuous=false;recognition.interimResults=false;recognition.lang='en-US';recognition.maxAlternatives=1;
    recognition.onstart=()=>{starting=false;if(handsFree&&!speaking){setState('Listening — say “Hey Robot”');setTalk('Hey Robot Ready');try{badge('Hey Robot Ready')}catch(_){}}};
    recognition.onresult=e=>{if(speaking)return;let heard='';for(let i=e.resultIndex;i<e.results.length;i++)heard+=e.results[i][0].transcript+' ';heard=heard.trim();if(!heard)return;const wake=heard.match(/\b(?:hey\s+)?robot\b[\s,.:;!?-]*(.*)$/i);let cmd='';if(wake){armedUntil=Date.now()+10000;cmd=(wake[1]||'').trim();if(!cmd){setState('Yes? I’m listening…');return}}else if(Date.now()<armedUntil)cmd=heard;else return;if(!cmd)return;armedUntil=0;try{recognition.abort()}catch(_){};setState('Thinking…');Promise.resolve(window.askAI?.(cmd)).catch(()=>{})};
    recognition.onerror=e=>{starting=false;if(e.error==='not-allowed'||e.error==='service-not-allowed'){handsFree=false;setState('Speech permission required.');setTalk('Enable Voice + Hey Robot');return}if(!speaking)scheduleRestart(e.error==='no-speech'?250:750)};
    recognition.onend=()=>{starting=false;if(handsFree&&!speaking)scheduleRestart(400)};
  }
  function selectVoice(){try{const vs=speechSynthesis.getVoices();return vs.find(x=>/^en-US$/i.test(x.lang)&&/Samantha|Ava|Aaron|Alex|Siri/i.test(x.name))||vs.find(x=>/^en-US$/i.test(x.lang))||vs.find(x=>/^en/i.test(x.lang))}catch(_){return null}}
  function unlockSpeech(confirm=false){try{speechSynthesis.cancel();speechSynthesis.resume();const u=new SpeechSynthesisUtterance(confirm?'Voice ready':' ');u.lang='en-US';u.volume=confirm?1:0;const v=selectVoice();if(v)u.voice=v;speechSynthesis.speak(u);voiceUnlocked=true;return true}catch(_){return false}}
  window.unlockEaraVoice=()=>unlockSpeech(true);
  window.say=function(text){const msg=String(text||'').trim();if(!msg)return;speaking=true;clearTimeout(restartTimer);clearTimeout(speechTimer);if(recognition){try{recognition.abort()}catch(_){}}try{speechSynthesis.cancel();speechSynthesis.resume()}catch(_){}const u=new SpeechSynthesisUtterance(msg);u.volume=1;u.rate=1;u.pitch=1;u.lang='en-US';const v=selectVoice();if(v)u.voice=v;let doneFlag=false;const done=()=>{if(doneFlag)return;doneFlag=true;clearTimeout(speechTimer);speaking=false;if(handsFree&&micAvailable()){setState('Listening — say “Hey Robot”');scheduleRestart(650)}};u.onstart=()=>{voiceUnlocked=true;setState('EARA speaking…');try{badge('Speaking')}catch(_){}};u.onend=done;u.onerror=()=>{done();setState('Tap Hey Robot Ready once to enable voice')};setTimeout(()=>{try{speechSynthesis.resume();speechSynthesis.speak(u)}catch(_){done()}speechTimer=setTimeout(done,Math.max(7000,Math.min(40000,msg.split(/\s+/).length*700+4000)))},250)};
  function enable(fromTap=false){setup();if(!SR){setState('Hands-free recognition is not supported in this browser.');return}if(fromTap)unlockSpeech(false);handsFree=true;setTalk('Hey Robot Ready');scheduleRestart(250)}
  function disable(){handsFree=false;clearTimeout(restartTimer);starting=false;if(recognition){try{recognition.abort()}catch(_){}}}
  window.addEventListener('eara-media-ready',()=>enable(false));
  window.addEventListener('eara-mic-enabled',()=>enable(false));
  window.addEventListener('eara-mic-disabled',disable);
  const talk=document.querySelector('#talk');if(talk)talk.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();unlockSpeech(true);enable(true);setState('Listening — say “Hey Robot”')},true);
  document.addEventListener('pointerdown',()=>{if(!voiceUnlocked)unlockSpeech(false)},{once:true,capture:true});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&handsFree&&!speaking)scheduleRestart(450)});
})();