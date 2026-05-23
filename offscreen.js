// offscreen.js — handles audio capture, delay buffer, speech recognition, and word-level muting

const AUDIO_DELAY_S = 0.4; // 400ms delay buffer
const WORD_MUTE_PADDING_MS = 100; // padding around detected word

let audioCtx = null;
let gainNode = null;
let recognition = null;
let blockedWords = [];
let muteTimeout = null;

// Receive messages from background
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'startCapture') {
    blockedWords = (msg.blockedWords || []).map(w => w.toLowerCase());
    startAudioPipeline(msg.streamId);
    sendResponse({ ok: true });
  }
  if (msg.action === 'stopCapture') {
    stopAll();
    sendResponse({ ok: true });
  }
  if (msg.action === 'updateBlockedWords') {
    blockedWords = (msg.blockedWords || []).map(w => w.toLowerCase());
    sendResponse({ ok: true });
  }
});

async function startAudioPipeline(streamId) {
  try {
    // Get the media stream from the tab capture stream ID
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      }
    });

    // Set up Web Audio pipeline: source → delay → gain → destination
    audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);

    const delayNode = audioCtx.createDelay(1.0);
    delayNode.delayTime.value = AUDIO_DELAY_S;

    gainNode = audioCtx.createGain();
    gainNode.gain.value = 1;

    const destination = audioCtx.createMediaStreamDestination();

    source.connect(delayNode);
    delayNode.connect(gainNode);
    gainNode.connect(destination);

    // Play the delayed audio through the <audio> element
    const audioEl = document.getElementById('delayedAudio');
    audioEl.srcObject = destination.stream;
    audioEl.play();

    // Start speech recognition on the real-time (non-delayed) stream
    startSpeechRecognition(stream);

    chrome.runtime.sendMessage({ action: 'captureStarted' });
  } catch (e) {
    chrome.runtime.sendMessage({ action: 'captureError', error: e.message });
  }
}

function startSpeechRecognition(stream) {
  const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
  if (!SpeechRecognition) {
    chrome.runtime.sendMessage({ action: 'captureError', error: 'Speech recognition not available' });
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript.toLowerCase();

      // Tokenize and check each word
      const words = transcript.match(/[a-z]+/g) || [];
      for (const word of words) {
        if (blockedWords.includes(word)) {
          // Word detected in real-time audio — mute the delayed output
          scheduleDelayedMute(word);
          break;
        }
      }
    }
  };

  recognition.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    // Restart on recoverable errors
    setTimeout(() => {
      try { recognition.start(); } catch (err) {}
    }, 500);
  };

  recognition.onend = () => {
    // Auto-restart to keep recognition running
    try { recognition.start(); } catch (e) {}
  };

  recognition.start();
}

function scheduleDelayedMute(word) {
  // The word was just detected in real-time audio.
  // It will appear in the delayed output in AUDIO_DELAY_S seconds.
  // Mute slightly before to catch the start of the word.
  const delayMs = (AUDIO_DELAY_S * 1000) - WORD_MUTE_PADDING_MS;
  const muteDurationMs = 500 + (WORD_MUTE_PADDING_MS * 2); // ~500ms for a word + padding

  setTimeout(() => {
    if (!gainNode) return;
    // Mute
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);

    // Clear any existing unmute timer
    if (muteTimeout) clearTimeout(muteTimeout);

    // Unmute after word duration
    muteTimeout = setTimeout(() => {
      if (!gainNode) return;
      gainNode.gain.setValueAtTime(1, audioCtx.currentTime);
      muteTimeout = null;
    }, muteDurationMs);
  }, Math.max(0, delayMs));
}

function stopAll() {
  if (recognition) {
    try { recognition.stop(); } catch (e) {}
    recognition = null;
  }
  if (audioCtx) {
    try { audioCtx.close(); } catch (e) {}
    audioCtx = null;
  }
  gainNode = null;
}
