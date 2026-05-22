// mic_prototype.js
// Lightweight wrapper to test the Web Speech API (microphone STT).
(function(){
  if (window.CleanMuteSTT && window.CleanMuteSTT._installed) return;
  const log = (...a) => console.log('CleanMuteSTT:', ...a);
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;

  function startMicSTT(lang = 'en-US') {
    if (!SpeechRecognition) { log('SpeechRecognition API not available in this browser'); return; }
    if (recognition) { log('Mic STT already running'); return; }
    recognition = new SpeechRecognition();
    recognition.lang = lang;
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => log('Mic STT started');
    recognition.onresult = (ev) => {
      let transcript = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        transcript += ev.results[i][0].transcript;
      }
      const isFinal = ev.results[ev.results.length-1].isFinal;
      log('Mic STT result', { transcript, isFinal });
      window.postMessage({ source: 'cleanmute-stt', type: 'mic-result', transcript, isFinal }, '*');
    };
    recognition.onerror = (e) => log('Mic STT error', e);
    recognition.onend = () => { log('Mic STT ended'); recognition = null; };
    try { recognition.start(); } catch (e) { log('Could not start recognition', e); }
  }

  function stopMicSTT() {
    if (!recognition) { log('Mic STT not running'); return; }
    recognition.stop();
    recognition = null;
  }

  window.CleanMuteSTT = window.CleanMuteSTT || {};
  window.CleanMuteSTT.startMicSTT = startMicSTT;
  window.CleanMuteSTT.stopMicSTT = stopMicSTT;
  window.CleanMuteSTT._installed = true;
  log('mic_prototype loaded — use CleanMuteSTT.startMicSTT()');
})();
