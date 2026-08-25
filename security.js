// EARA v33 client security: private Worker access key + security status UI.
(()=>{
  const BACKEND='https://eara-pwa.jesuscruz1984.workers.dev';
  const TOKEN_KEY='earaAccessTokenV1';
  const nativeFetch=window.fetch.bind(window);
  const $=s=>document.querySelector(s);

  function token(){return String(localStorage.getItem(TOKEN_KEY)||'').trim()}
  function isBackend(input){
    try{const u=new URL(typeof input==='string'?input:input.url,location.href);return u.origin===new URL(BACKEND).origin}catch(_){return false}
  }

  window.fetch=function(input,init={}){
    if(!isBackend(input))return nativeFetch(input,init);
    const headers=new Headers(init?.headers||(input instanceof Request?input.headers:undefined));
    const t=token();if(t)headers.set('X-Eara-Access',t);
    return nativeFetch(input,{...init,headers});
  };

  function randomKey(){
    const b=new Uint8Array(32);crypto.getRandomValues(b);
    return Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
  }

  async function copyText(text){try{await navigator.clipboard.writeText(text);return true}catch(_){return false}}
  function setStatus(text,ok=false){const e=$('#earaSecurityStatus');if(!e)return;e.textContent=text;e.style.color=ok?'#42f5bd':'#ffbf69'}

  async function checkSecurity(){
    try{
      const h=await nativeFetch(BACKEND+'/health',{cache:'no-store'}),j=await h.json();
      if(!j.securityConfigured){setStatus('Server lock NOT enabled yet. Generate a private key below, save it on this device, then add the same value to Cloudflare as secret EARA_ACCESS_TOKEN.',false);return}
      if(!token()){setStatus('Server lock is enabled, but this device has no private key. Enter the key and tap Save on Device.',false);return}
      const r=await window.fetch(BACKEND+'/auth-check',{cache:'no-store'});
      if(r.ok)setStatus('Private API lock ACTIVE. This device is authorized.',true);
      else setStatus('Server lock is active, but this device key does not match.',false);
    }catch(_){setStatus('Could not verify Worker security status right now.',false)}
  }

  function install(){
    const core=$('#settings .pad');if(!core||$('#earaSecurityPanel'))return;
    const d=document.createElement('div');d.id='earaSecurityPanel';d.style.cssText='margin-top:16px;padding-top:14px;border-top:1px solid #244a64';
    d.innerHTML=`<b>SECURITY // PRIVATE API</b>
      <div id="earaSecurityStatus" class="small" style="margin-top:7px">Checking security…</div>
      <div class="small" style="margin-top:9px">The private key is stored only on this device. It is never placed in the GitHub source code. After you add the same value to Cloudflare as the Secret named <b>EARA_ACCESS_TOKEN</b>, requests without the key are rejected before any AI model runs.</div>
      <input id="earaSecurityKey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="EARA private access key" style="margin-top:9px" />
      <div class="grid" style="margin-top:8px"><button id="earaGenerateKey" type="button">Generate 256-bit Key</button><button id="earaSaveKey" type="button">Save on Device</button><button id="earaCopyKey" type="button">Copy Key</button><button id="earaClearKey" type="button">Clear Device Key</button></div>
      <div class="small" style="margin-top:8px">Setup: Generate → Save on Device → Copy Key → Cloudflare Worker eara-pwa → Settings → Variables and Secrets → Add Secret → name it EARA_ACCESS_TOKEN → paste the key → Deploy. Do not put the key in GitHub or send it in chat.</div>`;
    core.appendChild(d);
    const input=$('#earaSecurityKey');input.value=token();
    $('#earaGenerateKey').onclick=()=>{input.value=randomKey();setStatus('New key generated. Save it on this device, then copy it into the Cloudflare secret.',false)};
    $('#earaSaveKey').onclick=()=>{const v=String(input.value||'').trim();if(v.length<32){setStatus('Use a long generated key (at least 32 characters).',false);return}localStorage.setItem(TOKEN_KEY,v);setStatus('Key saved on this device. Now make sure the same key is in Cloudflare EARA_ACCESS_TOKEN.',false);checkSecurity()};
    $('#earaCopyKey').onclick=async()=>{const v=String(input.value||token()).trim();if(!v){setStatus('Generate or enter a key first.',false);return}const ok=await copyText(v);setStatus(ok?'Key copied. Paste it directly into Cloudflare Secret EARA_ACCESS_TOKEN.':'Copy failed; select the key manually.',ok)};
    $('#earaClearKey').onclick=()=>{localStorage.removeItem(TOKEN_KEY);input.value='';setStatus('Private key removed from this device.',false)};
    checkSecurity();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){install();checkSecurity()}});
  window.getEaraAccessToken=token;
})();
