// EARA hands-free wake mode
// Starts after the user taps Start Camera + Mic once (required by iOS permissions).
(() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let handsFree = false;
  let speaking = false;
  let restarting = false;

  function setState(text) {
    const el = document.querySelector('#state');
    if (el) el.textContent = text;
  }

  function restartSoon(delay = 350) {
    if (!handsFree || speaking || !recognition || restarting) return;
    restarting = true;
    setTimeout(() => {
      restarting = false;
      if (!handsFree || speaking) return;
      try { recognition.start(); } catch (_) {}
    }, delay);
  }

  function setupRecognition() {
    if (!SR || recognition) return;
    recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      if (handsFree && !speaking) {
        setState('Hands-free — say “Hey EARA…”');
        try { badge('Hands-Free'); } catch (_) {}
      }
    };

    recognition.onresult = (event) => {
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalText += event.results[i][0].transcript + ' ';
      }
      finalText = finalText.trim();
      if (!finalText || speaking) return;

      const match = finalText.match(/(?:hey\s+)?(?:eara|era|aira|eira)[,\s:;-]*(.*)/i);
      if (!match) return;
      const command = (match[1] || '').trim();
      if (!command) {
        setState('I’m listening — ask me anything…');
        return;
      }

      const tr = document.querySelector('#transcript');
      if (tr) tr.textContent = 'You: ' + command;
      try { recognition.stop(); } catch (_) {}
      setState('Thinking…');
      askAI(command);
    };

    recognition.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        handsFree = false;
        setState('Speech recognition permission is required for hands-free mode.');
        return;
      }
      restartSoon(700);
    };
    recognition.onend = () => restartSoon();
  }

  // Pause wake listening while EARA speaks so it does not trigger itself.
  const originalSay = say;
  say = function(text) {
    speaking = true;
    if (recognition) { try { recognition.stop(); } catch (_) {} }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.onend = u.onerror = () => {
      speaking = false;
      restartSoon(250);
    };
    speechSynthesis.speak(u);
  };

  function enableHandsFree() {
    setupRecognition();
    if (!SR) {
      setState('Hands-free speech recognition is not supported in this browser.');
      return;
    }
    handsFree = true;
    restartSoon(100);
  }

  function disableHandsFree() {
    handsFree = false;
    if (recognition) { try { recognition.stop(); } catch (_) {} }
  }

  const startButton = document.querySelector('#start');
  if (startButton) {
    startButton.addEventListener('click', () => {
      setTimeout(() => {
        if (typeof stream !== 'undefined' && stream) enableHandsFree();
        else disableHandsFree();
      }, 700);
    });
  }

  // Replace the old push-to-talk label with a status/control fallback.
  const talkButton = document.querySelector('#talk');
  if (talkButton) {
    talkButton.textContent = 'Hands-Free Ready';
    talkButton.addEventListener('click', () => {
      if (!stream) return;
      handsFree = !handsFree;
      if (handsFree) {
        talkButton.textContent = 'Hands-Free Ready';
        enableHandsFree();
      } else {
        talkButton.textContent = 'Resume Hands-Free';
        disableHandsFree();
        setState('Hands-free paused');
      }
    }, true);
  }
})();