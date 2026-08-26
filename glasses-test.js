(() => {
  'use strict';

  const PRIMARY_SERVICE = '7905fff0-b5ce-4e99-a40f-4b1e122d00d0';
  const SECONDARY_SERVICE = '6e40fff0-b5a3-f393-e0a9-e50e24dcca9e';

  const $ = (id) => document.getElementById(id);
  const logEl = $('log');
  const topStatus = $('topStatus');
  const platformValue = $('platformValue');
  const bluetoothValue = $('bluetoothValue');
  const secureValue = $('secureValue');
  const browserStatus = $('browserStatus');
  const audioInput = $('audioInput');
  const audioStatus = $('audioStatus');
  const bleStatus = $('bleStatus');
  const micMeter = $('micMeter');

  let micStream = null;
  let audioContext = null;
  let analyser = null;
  let meterFrame = null;
  let bleDevice = null;
  let bleServer = null;

  function now() {
    return new Date().toLocaleTimeString();
  }

  function log(message, data) {
    const extra = data === undefined ? '' : `\n${typeof data === 'string' ? data : JSON.stringify(data, null, 2)}`;
    logEl.textContent += `\n[${now()}] ${message}${extra}`;
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setStatus(el, text, type = '') {
    el.textContent = text;
    el.classList.remove('good', 'bad');
    if (type) el.classList.add(type);
  }

  function describePlatform() {
    const ua = navigator.userAgent || '';
    const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches || navigator.standalone === true;
    const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);

    platformValue.textContent = `${ios ? 'iOS' : navigator.platform || 'Unknown'}${standalone ? ' • Home Screen/PWA' : ''}`;
    secureValue.textContent = window.isSecureContext ? 'Yes' : 'No';

    if ('bluetooth' in navigator) {
      bluetoothValue.textContent = 'Available';
      setStatus(browserStatus, 'Web Bluetooth is exposed by this browser. We can attempt a safe W610 BLE connection.', 'good');
      $('connectBle').disabled = false;
    } else {
      bluetoothValue.textContent = 'Not exposed';
      $('connectBle').disabled = true;
      const msg = ios
        ? 'This iPhone browser/PWA does not expose Web Bluetooth. W610 Bluetooth audio can still work through iOS, but direct camera/control commands cannot be sent from this pure PWA in this browser.'
        : 'This browser does not expose Web Bluetooth. Try a Web Bluetooth-capable browser for the BLE diagnostic.';
      setStatus(browserStatus, msg, 'bad');
    }

    topStatus.textContent = 'Ready';
    log('Environment checked', {
      userAgent: ua,
      secureContext: window.isSecureContext,
      standalone,
      ios,
      safari,
      webBluetooth: 'bluetooth' in navigator,
      mediaDevices: !!navigator.mediaDevices
    });
  }

  async function refreshAudioDevices() {
    if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices?.enumerateDevices) {
      setStatus(audioStatus, 'Media device APIs are unavailable in this browser.', 'bad');
      return;
    }

    try {
      const permissionStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
      permissionStream.getTracks().forEach((track) => track.stop());

      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === 'audioinput');
      audioInput.innerHTML = '';

      if (!inputs.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No audio inputs found';
        audioInput.appendChild(opt);
      } else {
        inputs.forEach((device, index) => {
          const opt = document.createElement('option');
          opt.value = device.deviceId;
          opt.textContent = device.label || `Microphone ${index + 1}`;
          audioInput.appendChild(opt);
        });
      }

      const labels = inputs.map((d, i) => d.label || `Microphone ${i + 1}`);
      const likelyW610 = labels.some((label) => /W610|HeyCyan|glasses|bluetooth/i.test(label));
      setStatus(
        audioStatus,
        `${inputs.length} microphone input${inputs.length === 1 ? '' : 's'} found.${likelyW610 ? ' A likely glasses/Bluetooth input is visible.' : ' iOS may present the current Bluetooth route under a generic microphone name.'}`,
        inputs.length ? 'good' : 'bad'
      );
      log('Audio devices refreshed', labels);
    } catch (err) {
      setStatus(audioStatus, `Microphone permission/test failed: ${err.message || err}`, 'bad');
      log('Audio device refresh failed', String(err));
    }
  }

  function stopMicTest() {
    if (meterFrame) cancelAnimationFrame(meterFrame);
    meterFrame = null;
    if (micStream) micStream.getTracks().forEach((track) => track.stop());
    micStream = null;
    if (audioContext) audioContext.close().catch(() => {});
    audioContext = null;
    analyser = null;
    micMeter.style.width = '0%';
    $('stopMic').disabled = true;
    $('testMic').disabled = false;
    setStatus(audioStatus, 'Mic test stopped.');
    log('Mic test stopped');
  }

  async function startMicTest() {
    stopMicTest();
    try {
      const selectedId = audioInput.value;
      const audioConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      };
      if (selectedId) audioConstraints.deviceId = { exact: selectedId };

      micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
      const track = micStream.getAudioTracks()[0];
      const settings = track.getSettings ? track.getSettings() : {};
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(micStream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);

      const draw = () => {
        if (!analyser) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        const pct = Math.min(100, Math.max(1, rms * 320));
        micMeter.style.width = `${pct}%`;
        meterFrame = requestAnimationFrame(draw);
      };
      draw();

      $('stopMic').disabled = false;
      $('testMic').disabled = true;
      setStatus(audioStatus, `Listening through: ${track.label || 'current audio input'}. Speak and watch the meter.`, 'good');
      log('Mic test started', { label: track.label, settings });
    } catch (err) {
      setStatus(audioStatus, `Mic test failed: ${err.message || err}`, 'bad');
      log('Mic test failed', String(err));
    }
  }

  function testSpeaker() {
    if (!('speechSynthesis' in window)) {
      setStatus(audioStatus, 'Speech synthesis is unavailable in this browser.', 'bad');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance('EARA audio test. If you hear this in your glasses, speaker routing is working.');
    utterance.rate = 1.03;
    utterance.onstart = () => {
      setStatus(audioStatus, 'Speaking now. Listen for EARA in the W610 speakers.', 'good');
      log('Speaker test started');
    };
    utterance.onend = () => log('Speaker test finished');
    utterance.onerror = (event) => {
      setStatus(audioStatus, `Speaker test error: ${event.error || 'unknown error'}`, 'bad');
      log('Speaker test error', event.error || 'unknown');
    };
    window.speechSynthesis.speak(utterance);
  }

  function characteristicProps(ch) {
    const p = ch.properties || {};
    return Object.keys(p).filter((k) => p[k]).sort();
  }

  async function inspectService(service) {
    const info = { uuid: service.uuid, characteristics: [] };
    try {
      const chars = await service.getCharacteristics();
      for (const ch of chars) {
        info.characteristics.push({ uuid: ch.uuid, properties: characteristicProps(ch) });
      }
    } catch (err) {
      info.error = String(err);
    }
    return info;
  }

  async function connectBle() {
    if (!navigator.bluetooth) {
      setStatus(bleStatus, 'Web Bluetooth is not available in this browser/PWA.', 'bad');
      return;
    }

    try {
      setStatus(bleStatus, 'Choose W610_F1CB in the Bluetooth picker…');
      log('Opening Web Bluetooth picker');
      bleDevice = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'W610' }],
        optionalServices: [PRIMARY_SERVICE, SECONDARY_SERVICE]
      });

      bleDevice.addEventListener('gattserverdisconnected', () => {
        setStatus(bleStatus, `${bleDevice?.name || 'W610'} disconnected.`);
        $('disconnectBle').disabled = true;
        log('BLE disconnected');
      });

      setStatus(bleStatus, `Connecting to ${bleDevice.name || 'W610'}…`);
      bleServer = await bleDevice.gatt.connect();
      $('disconnectBle').disabled = false;

      const services = [];
      for (const uuid of [PRIMARY_SERVICE, SECONDARY_SERVICE]) {
        try {
          const service = await bleServer.getPrimaryService(uuid);
          services.push(await inspectService(service));
        } catch (err) {
          services.push({ uuid, unavailable: true, error: String(err) });
        }
      }

      setStatus(bleStatus, `Connected to ${bleDevice.name || 'W610'}. Safe read-only service inspection completed.`, 'good');
      log('BLE connected', { name: bleDevice.name, id: bleDevice.id, services });
    } catch (err) {
      setStatus(bleStatus, `BLE connection failed/cancelled: ${err.message || err}`, 'bad');
      log('BLE connection failed/cancelled', String(err));
    }
  }

  function disconnectBle() {
    if (bleDevice?.gatt?.connected) bleDevice.gatt.disconnect();
    bleServer = null;
    $('disconnectBle').disabled = true;
    setStatus(bleStatus, 'Disconnected.');
    log('BLE disconnect requested');
  }

  async function copyLog() {
    try {
      await navigator.clipboard.writeText(logEl.textContent);
      topStatus.textContent = 'Diagnostics copied';
      setTimeout(() => { topStatus.textContent = 'Ready'; }, 1800);
    } catch (err) {
      log('Copy failed', String(err));
    }
  }

  $('refreshAudio').addEventListener('click', refreshAudioDevices);
  $('testMic').addEventListener('click', startMicTest);
  $('stopMic').addEventListener('click', stopMicTest);
  $('testSpeaker').addEventListener('click', testSpeaker);
  $('connectBle').addEventListener('click', connectBle);
  $('disconnectBle').addEventListener('click', disconnectBle);
  $('copyLog').addEventListener('click', copyLog);
  $('clearLog').addEventListener('click', () => { logEl.textContent = 'EARA Glasses Lab log cleared.'; });

  if (navigator.mediaDevices?.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', () => {
      log('Audio device change detected');
      refreshAudioDevices();
    });
  }

  window.addEventListener('beforeunload', () => {
    stopMicTest();
    disconnectBle();
  });

  describePlatform();
})();
