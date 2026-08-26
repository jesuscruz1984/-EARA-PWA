// EARA v34 ChatGPT-style conversation + live visual continuity layer.
(()=>{
  const $=s=>document.querySelector(s);
  const VISION_CONTEXT_MS=90*1000;
  const STORE='earaLiveVisionUntilV34';
  let enabled=true,baseAsk=null,installed=false;

  const now=()=>Date.now();
  function canUseCamera(){
    try{return !!window.getEaraStream?.()&&!window.isEaraScreenSharing?.()}catch(_){return false}
  }
  function liveUntil(){
    const n=Number(sessionStorage.getItem(STORE)||0);
    return Number.isFinite(n)?n:0;
  }
  function armVision(){
    sessionStorage.setItem(STORE,String(now()+VISION_CONTEXT_MS));
    updateSmartLine();
  }
  function visionRecent(){return enabled&&canUseCamera()&&now()<liveUntil()}
  function explicitVisual(q){
    return /\b(see|look|looking|show|showing|camera|holding|hold|in my hand|in front|this|that|these|those|item|object|label|read|scan|identify|picture|photo|image|what am i holding|what i'm holding|what is this|what's this|what do you see|take a look|check this out|look at this)\b/i.test(String(q||''));
  }
  function conversationalVisualFollowup(q){
    const t=String(q||'').trim();
    if(!t||t.length>180)return false;
    return /^(?:and\s+)?(?:what about now|how about now|now|and now|what changed|did it change|is it better|better now|is that better|is this better|what about this one|how about this one|this one|that one|the next one|what about the next one|which one|same thing|do you still see it|can you still see it|is it right|is this right|does that look right|closer|farther|there|like this)\??$/i.test(t)
      || /\b(now|this one|that one|next one|better|changed|still see|look right|closer|farther)\b/i.test(t);
  }

  function installAskWrapper(){
    if(installed||typeof window.askAI!=='function')return;
    baseAsk=window.askAI;
    window.askAI=async function(text){
      const original=String(text||'').trim();
      if(!original)return baseAsk(text);
      let outbound=original;
      if(explicitVisual(original)){
        armVision();
      }else if(visionRecent()&&conversationalVisualFollowup(original)){
        armVision();
        outbound=`Use the current live camera frame right now as visual context for this conversational follow-up. User said: ${original}`;
      }
      const result=await baseAsk(outbound);
      const transcript=$('#transcript');
      if(transcript&&outbound!==original)transcript.textContent='You: '+original;
      return result;
    };
    window.__earaChatStyleWrapped=true;
    installed=true;
  }

  function updateSmartLine(){
    let line=$('#earaSmartMode');
    const state=$('#state');
    if(!line&&state){
      line=document.createElement('div');
      line.id='earaSmartMode';
      line.className='small';
      line.style.marginTop='7px';
      line.style.color='#9edff7';
      state.insertAdjacentElement('afterend',line);
    }
    if(line){
      const visual=visionRecent()?' • live camera context active':'';
      line.textContent=`Smart mode: ask anything • automatic web when current info matters${visual}`;
    }
  }

  function simplifyUI(){
    const sub=document.querySelector('header .sub');
    if(sub)sub.textContent='ASK ANYTHING • TALK NATURALLY • LIVE VISION';
    const personaPill=$('.personaPill');
    if(personaPill)personaPill.style.display='none';

    const typed=$('#typed');
    if(typed){
      typed.placeholder='Message Eara…';
      typed.setAttribute('autocomplete','off');
      typed.setAttribute('enterkeyhint','send');
    }

    const reply=$('#reply');
    if(reply&&/EARA starts listening automatically|Take Photo saves|Start Visit Memory/i.test(reply.textContent||'')){
      reply.textContent='Ask me anything. Talk naturally, or point the camera at something and ask about it. I can use the web automatically when current information matters.';
    }

    const livePersona=$('#personaLiveSelect');
    if(livePersona){
      const wrap=livePersona.parentElement;
      if(wrap)wrap.style.display='none';
    }

    const tasksBtn=document.querySelector('nav button[data-tab="tasks"]');
    if(tasksBtn)tasksBtn.style.display='none';
    const nav=document.querySelector('nav');
    if(nav)nav.style.gridTemplateColumns='repeat(3,1fr)';

    const ai=$('#ai');
    if(ai&&/standby|ready/i.test(ai.textContent||''))ai.textContent='SMART AI';

    updateSmartLine();
  }

  window.addEventListener('eara-media-ready',()=>{armVision();setTimeout(()=>{installAskWrapper();simplifyUI()},40)});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){setTimeout(()=>{installAskWrapper();simplifyUI()},50)}});
  window.addEventListener('focus',()=>setTimeout(()=>{installAskWrapper();simplifyUI()},40));

  setTimeout(()=>{installAskWrapper();simplifyUI()},0);
  setTimeout(()=>{installAskWrapper();simplifyUI()},300);
  setTimeout(()=>{installAskWrapper();simplifyUI()},1200);
})();
