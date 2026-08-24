// EARA fast hands-free wake phrase: Eara
(()=>{
  const nativeSpeech=window.EARANative&&typeof window.EARANative.startListening==='function'?window.EARANative:null;
  function NativeSpeechRecognition(){
    this.continuous=false;this.interimResults=true;this.lang='en-US';this.maxAlternatives=3;this._started=false;
    const emitResult=(text,isFinal)=>{const alt={transcript:String(text||'')},result=[alt];result.isFinal=!!isFinal;const results=[result];this.onresult?.({resultIndex:0,results})};
    this._listener=e=>{const d=e.detail||{};if(!this._started)return;if(d.type==='result')emitResult(d.text,d.final);else if(d.type==='error')this.onerror?.({error:d.error||'no-speech'});else if(d.type==='end'){this._started=false;this.onend?.()}};
    window.addEventListener('eara-native-speech',this._listener);
    this.start=()=>{if(this._started)return;this._started=true;this.onstart?.();try{nativeSpeech.startListening()}catch(_){this._started=false;this.onerror?.({error:'audio-capture'});this.onend?.()}};
    this.abort=()=>{if(!this._started)return;try{nativeSpeech.stopListening()}catch(_){}this._started=false};
    this.stop=this.abort;
  }
  const SR=nativeSpeech?NativeSpeechRecognition:(window.SpeechRecognition||window.webkitSpeechRecognition);
  const WAKE=/^\s*(?:(?:hey|ok|okay)\s+)?(?:eara|era|aira|eira|eera|ear\s+a)\b[\s,.:;!?-]*(.*)$/i;
  const ACTIVE_MS=10000;
  const COMMAND_SILENCE_MS=650;
  const PREMIUM_TTS_TIMEOUT_MS=1800;

  let recognition=null,handsFree=false,speaking=false,processing=false,starting=false;
  let restartTimer=null,activeTimer=null,commandTimer=null,activeUntil=0,active=false,commandBuffer='';
  let player=null,speakerEnabled=true,audioPrimed=false,speechErrorCount=0,currentObjectUrl='';

  const setState=t=>{const e=document.querySelector('#state');if(e)e.textContent=t};
  const setTalk=t=>{const e=document.querySelector('#talk');if(e)e.textContent=t};
  const setBadge=t=>{try{badge(t)}catch(_){}};
  const micAvailable=()=>!!(window.getEaraStream?.()&&window.isEaraMicEnabled?.());
  const idleState=()=>active?'Eara active — keep talking':'Listening for “Eara”';
  const idleBadge=()=>active?'Eara Active':'Eara Ready';

  function ensurePlayer(){if(player)return player;player=document.createElement('audio');player.setAttribute('playsinline','');player.preload='auto';player.style.display='none';document.body.appendChild(player);return player}
  function updateSpeakerButton(){setTalk(speakerEnabled?'Speaker: ON':'Speaker: OFF')}
  function spokenVersion(text,full=false){
    const raw=String(text||'').trim();if(!raw)return '';
    const hadLink=/(?:https?:\/\/|www\.)/i.test(raw);
    let clean=raw.replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)]+\)/gi,'$1').replace(/(?:https?:\/\/|www\.)\S+/gi,'').replace(/\b(?:direct\s+)?(?:amazon|product|purchase|buy|website)?\s*(?:link|url)\s*[:\-]?\s*/gi,'').replace(/[\*_\`#>|]+/g,' ').replace(/\s+/g,' ').trim();
    if(!clean&&hadLink)return 'I found the link and put it in the text notes on screen.';
    if(full)return clean;
    const sentences=clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[clean];
    let short=sentences.slice(0,2).join(' ').trim();
    if(short.length>270){short=short.slice(0,270);const cut=short.lastIndexOf(' ');if(cut>210)short=short.slice(0,cut);short=short.replace(/[,:;\-\s]+$/,'')+'.'}
    if(hadLink&&!/\b(?:link|links|text notes|on screen|screen)\b/i.test(short))short+=(/[.!?]$/.test(short)?'':' .')+' The links are in the text notes on screen.';
    return short.replace(/\s+\./g,'.').trim();
  }
  function speechChunks(text,max=260){
    const clean=spokenVersion(text,true);if(!clean)return [];
    const sentences=clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[clean],out=[];let current='';
    const pushWords=part=>{for(const word of part.split(/\s+/)){if(!word)continue;if(current&&current.length+word.length+1>max){out.push(current.trim());current=''}current+=(current?' ':'')+word}};
    for(const sentence of sentences){if(sentence.length>max){if(current){out.push(current.trim());current=''}pushWords(sentence);continue}if(current&&current.length+sentence.length+1>max){out.push(current.trim());current=''}current+=(current?' ':'')+sentence.trim()}
    if(current)out.push(current.trim());return out.filter(Boolean);
  }

  function clearActiveTimer(){clearTimeout(activeTimer);activeTimer=null}
  function armActive(){active=true;activeUntil=Date.now()+ACTIVE_MS;clearActiveTimer();activeTimer=setTimeout(checkActiveTimeout,ACTIVE_MS+80);if(!speaking&&!processing){setState(idleState());setBadge(idleBadge())}}
  function checkActiveTimeout(){if(!active)return;const remain=activeUntil-Date.now();if(remain>0){activeTimer=setTimeout(checkActiveTimeout,remain+80);return}if(speaking||processing){activeUntil=Date.now()+1200;activeTimer=setTimeout(checkActiveTimeout,1300);return}active=false;commandBuffer='';clearTimeout(commandTimer);commandTimer=null;setState('Listening for “Eara”');setBadge('Eara Ready')}
  function appendCommand(segment){const s=String(segment||'').trim();if(!s)return;armActive();if(!commandBuffer)commandBuffer=s;else if(!commandBuffer.toLowerCase().endsWith(s.toLowerCase()))commandBuffer+=' '+s;clearTimeout(commandTimer);commandTimer=setTimeout(submitCommand,COMMAND_SILENCE_MS);setState('Eara active — listening…');setBadge('Eara Active')}
  function submitCommand(){clearTimeout(commandTimer);commandTimer=null;if(!commandBuffer||processing||speaking){if(commandBuffer)commandTimer=setTimeout(submitCommand,220);return}const cmd=commandBuffer.trim();commandBuffer='';if(!cmd)return;processing=true;armActive();try{recognition?.abort()}catch(_){}setState('Thinking…');setBadge('Thinking');Promise.resolve(window.askAI?.(cmd)).catch(()=>{}).finally(()=>{processing=false;if(active)armActive();if(handsFree&&!speaking&&micAvailable())scheduleRestart(80)})}

  function scheduleRestart(delay=120){clearTimeout(restartTimer);if(!handsFree||speaking||processing||!recognition||!micAvailable())return;const backoff=Math.min(1800,speechErrorCount*250);restartTimer=setTimeout(()=>{if(!handsFree||speaking||processing||starting||!micAvailable())return;try{starting=true;recognition.start()}catch(_){starting=false;speechErrorCount=Math.min(speechErrorCount+1,6);scheduleRestart(300)}},Math.max(delay,backoff))}
  function pickTranscript(result){if(!result)return '';if(!active){for(let i=0;i<Math.min(result.length,3);i++){const t=String(result[i]?.transcript||'').trim();if(WAKE.test(t))return t}}return String(result[0]?.transcript||'').trim()}
  function setupRecognition(){
    if(!SR||recognition)return;recognition=new SR();recognition.continuous=false;recognition.interimResults=true;recognition.lang='en-US';recognition.maxAlternatives=3;
    recognition.onstart=()=>{starting=false;speechErrorCount=0;if(handsFree&&!speaking&&!processing){setState(idleState());updateSpeakerButton();setBadge(idleBadge())}};
    recognition.onresult=e=>{if(speaking||processing)return;for(let i=e.resultIndex;i<e.results.length;i++){const res=e.results[i],heard=pickTranscript(res);if(!heard)continue;const wake=heard.match(WAKE);if(wake){armActive();if(!res.isFinal){setState('Eara heard — I’m listening…');setBadge('Eara Active');continue}const rest=String(wake[1]||'').trim();if(rest)appendCommand(rest);else{setState('Yes? I’m listening…');setBadge('Eara Active')}continue}if(!active)continue;armActive();if(res.isFinal)appendCommand(heard);else{setState('Eara active — listening…');setBadge('Eara Active')}}};
    recognition.onerror=e=>{starting=false;const err=String(e?.error||'');if(err==='not-allowed'||err==='service-not-allowed'){if(micAvailable()){speechErrorCount=Math.min(speechErrorCount+1,6);setState('Reconnecting listener…');setBadge('Reconnecting…');scheduleRestart(450)}else{handsFree=false;setState('Microphone permission required.');setBadge('Mic Permission')}return}if(err==='audio-capture'&&!micAvailable()){setState('Microphone unavailable.');return}speechErrorCount=Math.min(speechErrorCount+1,6);if(!speaking&&!processing)scheduleRestart(err==='no-speech'?70:250)};
    recognition.onend=()=>{starting=false;if(handsFree&&!speaking&&!processing)scheduleRestart(active?50:120)};
  }

  function localSpeak(text,onDone){
    if(!speakerEnabled)return false;const msg=spokenVersion(text);if(!msg)return false;
    try{speechSynthesis.cancel();speechSynthesis.resume();const u=new SpeechSynthesisUtterance(msg);u.lang='en-US';u.volume=1;u.rate=1.03;const voices=speechSynthesis.getVoices();const v=voices.find(x=>/^en-US$/i.test(x.lang)&&/Samantha|Ava|Aaron|Alex|Siri/i.test(x.name))||voices.find(x=>/^en/i.test(x.lang));if(v)u.voice=v;let finished=false;const finish=()=>{if(finished)return;finished=true;clearTimeout(safety);if(typeof onDone==='function')onDone()};const safety=setTimeout(finish,Math.max(6000,msg.length*85));u.onend=finish;u.onerror=finish;speechSynthesis.speak(u);return true}catch(_){return false}
  }
  async function primeAudio(){if(!speakerEnabled)return false;const p=ensurePlayer();try{p.src='data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';p.volume=0.01;await p.play();p.pause();p.currentTime=0;p.volume=1;audioPrimed=true;return true}catch(_){return false}}
  function revokeObjectUrl(){if(currentObjectUrl){try{URL.revokeObjectURL(currentObjectUrl)}catch(_){}currentObjectUrl=''}}
  function audioBlobFromBase64(b64,mime){const bin=atob(String(b64||'')),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return new Blob([bytes],{type:mime||'audio/mpeg'})}
  async function playBlob(blob,onDone,msg){
    const p=ensurePlayer();try{p.pause()}catch(_){}revokeObjectUrl();currentObjectUrl=URL.createObjectURL(blob);p.src=currentObjectUrl;p.volume=1;let finished=false;
    const finish=()=>{if(finished)return;finished=true;revokeObjectUrl();onDone()};p.onended=finish;p.onerror=()=>{revokeObjectUrl();setState('EARA speaking…');setBadge('Speaking');if(!localSpeak(msg,finish))finish()};
    try{p.load();await p.play();audioPrimed=true;setState('EARA speaking…');setBadge('Speaking');return true}catch(_){revokeObjectUrl();setState('EARA speaking…');setBadge('Speaking');if(localSpeak(msg,finish))return true;finish();return false}
  }

  async function cloudSpeak(text,options={}){
    const full=!!options?.full,msg=spokenVersion(text,full),chunks=full?speechChunks(msg):[spokenVersion(msg)].filter(Boolean);
    if(!chunks.length||!speakerEnabled){if(active)armActive();if(handsFree&&micAvailable())scheduleRestart(70);return}
    speaking=true;clearTimeout(restartTimer);try{recognition?.abort()}catch(_){}setState('Preparing voice…');setBadge('Loading voice…');
    const finishAll=()=>{speaking=false;if(active)armActive();if(handsFree&&micAvailable()){setState(idleState());setBadge(idleBadge());scheduleRestart(80)}};
    const playOne=async(chunk,index)=>new Promise(async resolve=>{
      let resolved=false;const finish=()=>{if(resolved)return;resolved=true;resolve()};
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),PREMIUM_TTS_TIMEOUT_MS);
      try{
        const r=await fetch('https://eara-pwa.jesuscruz1984.workers.dev/tts?raw=1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:chunk,speaker:window.getEaraVoice?.()||'asteria'}),cache:'no-store',signal:controller.signal});
        clearTimeout(timeout);if(!r.ok)throw new Error(await r.text());const type=(r.headers.get('content-type')||'').toLowerCase();let blob;
        if(type.includes('audio/'))blob=await r.blob();else{const j=await r.json();if(!j.audio)throw new Error('No audio returned');blob=audioBlobFromBase64(j.audio,j.mime||'audio/mpeg')}
        setState(chunks.length>1?`EARA speaking — part ${index+1} of ${chunks.length}…`:'EARA speaking…');setBadge('Speaking');const played=await playBlob(blob,finish,chunk);if(!played)finish();
      }catch(_){
        clearTimeout(timeout);setState(chunks.length>1?`EARA speaking — part ${index+1} of ${chunks.length}…`:'EARA speaking…');setBadge('Speaking');
        if(!localSpeak(chunk,finish))finish();
      }
    });
    try{for(let i=0;i<chunks.length&&speakerEnabled;i++)await playOne(chunks[i],i)}finally{finishAll()}
  }

  window.say=cloudSpeak;window.unlockEaraVoice=primeAudio;window.isEaraSpeakerEnabled=()=>speakerEnabled;window.getEaraSpokenVersion=spokenVersion;window.isEaraActive=()=>active;
  function enable(){setupRecognition();if(!SR){setState('Hands-free recognition is not supported in this browser.');return}handsFree=true;speechErrorCount=0;updateSpeakerButton();scheduleRestart(40);primeAudio()}
  function disable(){handsFree=false;clearTimeout(restartTimer);clearTimeout(commandTimer);clearActiveTimer();starting=false;active=false;commandBuffer='';try{recognition?.abort()}catch(_){}}
  function recoverListening(){if(!micAvailable())return;setupRecognition();handsFree=true;speechErrorCount=0;if(!speaking&&!processing)scheduleRestart(35)}
  window.forceEaraListening=recoverListening;window.addEventListener('eara-media-ready',enable);window.addEventListener('eara-mic-enabled',enable);window.addEventListener('eara-mic-disabled',disable);

  const talk=document.querySelector('#talk');if(talk)talk.addEventListener('click',async e=>{e.preventDefault();e.stopImmediatePropagation();speakerEnabled=!speakerEnabled;updateSpeakerButton();if(!speakerEnabled){try{player?.pause()}catch(_){}revokeObjectUrl();try{speechSynthesis.cancel()}catch(_){}setState(active?'Eara active — speaker off':'Listening for “Eara”');setBadge('Speaker Off');recoverListening()}else{await primeAudio();recoverListening();setState(idleState());setBadge(idleBadge())}},true);
  document.addEventListener('pointerdown',()=>{if(speakerEnabled&&!audioPrimed)primeAudio();recoverListening()},{capture:true});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){recoverListening();if(speakerEnabled)primeAudio()}});window.addEventListener('focus',recoverListening);updateSpeakerButton();
})();
