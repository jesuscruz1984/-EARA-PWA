const fs=require('fs');
const vm=require('vm');

class Target{
  constructor(){this.listeners={}}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn)}
  dispatchEvent(event){for(const fn of this.listeners[event.type]||[])fn(event)}
}

let nativeStarts=0,recorderStarts=0,asked='';
const audioTrack={readyState:'live',enabled:true,clone(){return {readyState:'live',enabled:true,stop(){}}}};
const stream={getAudioTracks(){return [audioTrack]}};
class Recorder{
  static isTypeSupported(){return true}
  constructor(){this.state='inactive';this.mimeType='audio/webm;codecs=opus'}
  start(){this.state='recording';recorderStarts++}
  stop(){this.state='inactive';this.ondataavailable?.({data:new Blob([new Uint8Array(1200)],{type:this.mimeType})});this.onstop?.()}
}
class AudioContextMock{
  constructor(){this.state='running'}
  resume(){return Promise.resolve()}
  createMediaStreamSource(){return {connect(){}}}
  createAnalyser(){let reads=0;return {fftSize:512,getByteTimeDomainData(a){reads++;for(let i=0;i<a.length;i++)a[i]=reads<5?(i%2?138:118):128}}}
}
const window=new Target();
window.window=window;
window.EARANative={startListening(){nativeStarts++},stopListening(){},isListening(){return false}};
window.MediaRecorder=Recorder;
window.AudioContext=AudioContextMock;
window.getEaraStream=()=>stream;
window.isEaraMicEnabled=()=>true;
window.askAI=cmd=>{asked=cmd;return Promise.resolve()};
window.speechSynthesis={cancel(){},resume(){},getVoices(){return []},speak(){}};
const document=new Target();
document.querySelector=()=>null;
document.createElement=()=>({setAttribute(){},style:{},play(){return Promise.resolve()},pause(){},load(){}});
document.body={appendChild(){}};
const context={window,document,navigator:{mediaDevices:{}},MediaRecorder:Recorder,MediaStream:class{constructor(tracks){this.tracks=tracks}},AudioContext:AudioContextMock,Blob,FormData,AbortController,URL,fetch:async()=>({ok:true,text:async()=>'{"text":"Eara what time is it"}'}),speechSynthesis:window.speechSynthesis,SpeechSynthesisUtterance:class{},setTimeout,clearTimeout,setInterval,clearInterval,console};
vm.createContext(context);
vm.runInContext(fs.readFileSync('handsfree.js','utf8'),context,{filename:'handsfree.js'});
window.dispatchEvent({type:'eara-media-ready'});
setTimeout(()=>{
  if(nativeStarts!==0)throw new Error(`native recognizer started ${nativeStarts} times`);
  if(recorderStarts<1)throw new Error('stream recorder did not start');
  if(asked!=='what time is it')throw new Error(`wake command was not delivered: ${asked}`);
  console.log('EARA_V43_STREAM_MIC_SELECTION=PASS');
  console.log('EARA_V43_WAKE_TRANSCRIPTION=PASS');
  process.exit(0);
},2400);

