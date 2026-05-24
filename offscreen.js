// offscreen.js — audio capture, delay buffer, speech recognition, word-level muting

const DELAY_S = 0.3;
const MUTE_DURATION_MS = 600;

let audioCtx = null;
let gainNode = null;
let recognition = null;
let blockedSet = new Set();
let muteTimer = null;
let running = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'offscreen-start') {
    const words = (msg.blockedWords || []).map(w => w.toLowerCase());
    blockedSet = new Set(words);
    start(msg.streamId);
    sendResponse({ ok: true });
  }
  if (msg.action === 'offscreen-stop') {
    stop();
    sendResponse({ ok: true });
  }
  if (msg.action === 'offscreen-update-words') {
    const words = (msg.blockedWords || []).map(w => w.toLowerCase());
    blockedSet = new Set(words);
    sendResponse({ ok: true });
  }
});

async function start(streamId) {
  if (running) stop();
  running = true;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      }
    });

    audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);

    // Delay node — buffers audio so we can mute before it reaches output
    const delay = audioCtx.createDelay(1.0);
    delay.delayTime.value = DELAY_S;

    // Gain node — set to 0 to mute, 1 to unmute
    gainNode = audioCtx.createGain();
    gainNode.gain.value = 1;

    // Connect: source → delay → gain → speakers
    source.connect(delay);
    delay.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    // Start speech recognition on the real-time (non-delayed) audio
    startRecognition();

    chrome.runtime.sendMessage({ action: 'offscreen-ready' });
  } catch (e) {
    chrome.runtime.sendMessage({ action: 'offscreen-error', error: e.message });
  }
}

function startRecognition() {
  const SR = window.webkitSpeechRecognition || window.SpeechRecognition;
  if (!SR) {
    chrome.runtime.sendMessage({ action: 'offscreen-error', error: 'No SpeechRecognition API' });
    return;
  }

  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript.toLowerCase();
      const words = transcript.match(/[a-z]+/g) || [];

      for (const word of words) {
        if (blockedSet.has(word)) {
          scheduleMute(word);
          return;
        }
        // Check partial matches (e.g. "fucking" contains "fuck")
        for (const blocked of blockedSet) {
          if (word.includes(blocked) || blocked.includes(word)) {
            if (word.length >= 3 && blocked.length >= 3) {
              scheduleMute(blocked);
              return;
            }
          }
        }
      }
    }
  };

  recognition.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') {
      // Normal, restart
      restartRecognition();
      return;
    }
    restartRecognition();
  };

  recognition.onend = () => {
    if (running) restartRecognition();
  };

  try {
    recognition.start();
  } catch (e) {
    restartRecognition();
  }
}

function restartRecognition() {
  if (!running) return;
  setTimeout(() => {
    if (!running) return;
    try {
      if (recognition) recognition.start();
    } catch (e) {
      // Already running or other error, retry
      setTimeout(restartRecognition, 1000);
    }
  }, 200);
}

function scheduleMute(word) {
  if (!gainNode || !audioCtx) return;

  // Word was just detected in real-time audio.
  // It will reach the delayed output in DELAY_S seconds.
  const muteIn = Math.max(0, (DELAY_S * 1000) - 100); // slightly early

  setTimeout(() => {
    if (!gainNode || !audioCtx) return;
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);

    if (muteTimer) clearTimeout(muteTimer);
    muteTimer = setTimeout(() => {
      if (!gainNode || !audioCtx) return;
      gainNode.gain.setValueAtTime(1, audioCtx.currentTime);
      muteTimer = null;
    }, MUTE_DURATION_MS);
  }, muteIn);
}

function stop() {
  running = false;
  if (recognition) {
    try { recognition.stop(); } catch (e) {}
    recognition = null;
  }
  if (audioCtx) {
    try { audioCtx.close(); } catch (e) {}
    audioCtx = null;
  }
  gainNode = null;
  if (muteTimer) {
    clearTimeout(muteTimer);
    muteTimer = null;
  }
}
