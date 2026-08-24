// EARA persistent hands-free wake phrase: Hey Robot
(()=>{
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  let recognition=null,handsFree=false,speaking=false,starting=false,restartTimer=null,armedUntil=0,currentAudio=null,currentUrl=null;
  const setState=t=>{const e=document.querySelector('#state');if(e)e.textContent=t};
  const setTalk=t=>{const e=document.querySelector('#talk');if(e)e.textContent=t};
  function micAvailable(){return !!(window.getEaraStream?.()&&window.isEaraMicEnabled?.())}
  function scheduleRestart(delay=450){clearTimeout(restartTimer);if(!handsFree||speaking||!recognition||!micAvailable())return;restartTimer=setTimeout(()=>{if(!handsFree||speaking||starting||!micAvailable())return;try{starting=true;recognition.start()}catch(_){starting=false;scheduleRestart(1000)}},delay)}
  function setup(){if(!SR||recognition)return;recognition=new SR();recognition.continuous=false;recognition.interimResults=false;recognition.lang='en-US';recognition.maxAlternatives=1;
    recognition.onstart=()=>{starting=false;if(handsFree&&!speaking){setState('Listening — say “Hey Robot”');setTalk('Hey Robot Ready');try{badge('Hey Robot Ready')}catch(_){}}};
    recognition.onresult=e=>{if(speaking)return;let heard='';for(let i=e.resultIndex;i<e.results.length;i++)heard+=e.results[i][0].transcript+' ';heard=heard.trim();if(!heard)return;const wake=heard.match(/\b(?:hey\s+)?robot\b[\s,.:;!?-]*(.*)$/i);let cmd='';if(wake){armedUntil=Date.now()+10000;cmd=(wake[1]||'').trim();if(!cmd){setState('Yes? I’m listening…');return}}else if(Date.now()<armedUntil)cmd=heard;else return;if(!cmd)return;armedUntil=0;try{recognition.abort()}catch(_){};setState('Thinking…');Promise.resolve(window.askAI?.(cmd)).catch(()=>{})};
    recognition.onerror=e=>{starting=false;if(e.error==='not-allowed'||e.error==='service-not-allowed'){handsFree=false;setState('Speech permission required.');setTalk('Resume Hey Robot');return}if(!speaking)scheduleRestart(e.error==='no-speech'?250:750)};
    recognition.onend=()=>{starting=false;if(handsFree&&!speaking)scheduleRestart(400)};
  }
  async function cloudSpeak(text){
    const msg=String(text||'').trim();if(!msg)return;
    speaking=true;clearTimeout(restartTimer);if(recognition){try{recognition.abort()}catch(_){}}
    setState('EARA speaking…');try{badge('Speaking')}catch(_){}
    try{
      if(currentAudio){try{currentAudio.pause()}catch(_){}currentAudio=null}
      if(currentUrl){URL.revokeObjectURL(currentUrl);currentUrl=null}
      const r=await fetch('https://eara-pwa.jesuscruz1984.workers.dev/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:msg})});
      if(!r.ok)throw new Error(await r.text());
      const blob=await r.blob();
      currentUrl=URL.createObjectURL(blob);currentAudio=new Audio(currentUrl);currentAudio.volume=1;
      const done=()=>{speaking=false;if(currentUrl){URL.revokeObjectURL(currentUrl);currentUrl=null}currentAudio=null;if(handsFree&&micAvailable()){setState('Listening — say “Hey Robot”');scheduleRestart(650)}};
      currentAudio.onended=done;currentAudio.onerror=done;
      await currentAudio.play();
    }catch(_){speaking=false;setState('Voice playback failed — tap Speak Again');try{badge('Voice Error')}catch(_){};if(handsFree&&micAvailable())scheduleRestart(650)}
  }
  window.say=cloudSpeak;window.unlockEaraVoice=()=>{};
  function enable(){setup();if(!SR){setState('Hands-free recognition is not supported in this browser.');return}handsFree=true;setTalk('Hey Robot Ready');scheduleRestart(250)}
  function disable(){handsFree=false;clearTimeout(restartTimer);starting=false;if(recognition){try{recognition.abort()}catch(_){}}}
  window.addEventListener('eara-media-ready',enable);window.addEventListener('eara-mic-enabled',enable);window.addEventListener('eara-mic-disabled',disable);
  const talk=document.querySelector('#talk');if(talk)talk.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();if(!micAvailable())return;if(handsFree){disable();setTalk('Resume Hey Robot');setState('Hands-free paused')}else enable()},true);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&handsFree&&!speaking)scheduleRestart(450)});
})();