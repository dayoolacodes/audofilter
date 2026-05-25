// popup.js — manage UI, settings, and capture mode
const DEFAULTS = {
  enabled: true,
  blockedWords: [],
  muteDuration: 1500,
  testMode: false,
  preMuteLeadMs: 250
};

function $(id) { return document.getElementById(id); }

function load() {
  chrome.storage.sync.get(DEFAULTS, (items) => {
    $('enableFilter').checked = items.enabled;
    $('blockedWords').value = (items.blockedWords || []).join('\n');
    $('muteDuration').value = items.muteDuration || DEFAULTS.muteDuration;
    $('preMuteLead').value = items.preMuteLeadMs || DEFAULTS.preMuteLeadMs;
  });
}

function save() {
  const blocked = $('blockedWords').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const data = {
    enabled: $('enableFilter').checked,
    blockedWords: blocked,
    muteDuration: parseInt($('muteDuration').value,10) || DEFAULTS.muteDuration,
    preMuteLeadMs: parseInt($('preMuteLead').value,10) || DEFAULTS.preMuteLeadMs
  };
  chrome.storage.sync.set(data, () => {
    setStatus('Saved');
    chrome.tabs.query({active:true, currentWindow:true}, (tabs) => {
      if (!tabs || !tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, {action:'reloadSettings'}, () => {
        void chrome.runtime.lastError;
      });
    });
    // Update offscreen words if capture is running
    chrome.runtime.sendMessage({action: 'offscreen-update-words', blockedWords: blocked}, () => {
      void chrome.runtime.lastError;
    });
  });
}

function setStatus(text) {
  $('status').textContent = text || '';
}

function checkStatus() {
  // Check capture mode
  chrome.runtime.sendMessage({action: 'getCaptureStatus'}, (resp) => {
    void chrome.runtime.lastError;
    if (resp && resp.active) {
      setStatus('Audio capture active');
      $('captureBtn').style.display = 'none';
      $('stopCaptureBtn').style.display = '';
      return;
    }
    $('captureBtn').style.display = '';
    $('stopCaptureBtn').style.display = 'none';

    // Check subtitle mode
    chrome.tabs.query({active:true, currentWindow:true}, (tabs) => {
      if (!tabs || !tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, {action:'getStatus'}, (r) => {
        if (chrome.runtime.lastError || !r) {
          setStatus('Not active on this page');
          return;
        }
        if (r.mode === 'subtitle-file') {
          setStatus('Subtitle file — ' + r.mutePoints + ' mute points');
        } else {
          setStatus('DOM scan mode');
        }
      });
    });
  });
}

function startCapture() {
  chrome.tabs.query({active:true, currentWindow:true}, (tabs) => {
    if (!tabs || !tabs[0]) { setStatus('No active tab'); return; }
    chrome.runtime.sendMessage({action: 'startCapture', tabId: tabs[0].id}, (resp) => {
      if (chrome.runtime.lastError) {
        setStatus('Error: ' + chrome.runtime.lastError.message);
        return;
      }
      if (resp && resp.ok) {
        setStatus('Audio capture active (~300ms delay)');
        $('captureBtn').style.display = 'none';
        $('stopCaptureBtn').style.display = '';
      } else {
        setStatus('Capture failed: ' + (resp && resp.error || 'unknown'));
      }
    });
  });
}

function stopCapture() {
  chrome.runtime.sendMessage({action: 'stopCapture'}, () => {
    void chrome.runtime.lastError;
    setStatus('Capture stopped');
    $('captureBtn').style.display = '';
    $('stopCaptureBtn').style.display = 'none';
  });
}

// ---- Waveform visualizer ----
let waveActive = false;
let waveMuted = false;

function startWave() {
  const canvas = $('waveCanvas');
  const label = $('waveLabel');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  let offset = 0;

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const bars = 60;
    const barW = W / bars;

    for (let i = 0; i < bars; i++) {
      let h;
      if (waveActive) {
        // Simulate audio waveform
        h = Math.abs(Math.sin((i + offset) * 0.15) * Math.cos((i - offset) * 0.08)) * H * 0.8;
        h += Math.random() * 6;
        h = Math.max(3, h);
      } else {
        // Flat line when inactive
        h = 2;
      }

      const x = i * barW;
      const y = (H - h) / 2;

      if (waveMuted) {
        ctx.fillStyle = '#e94560';
      } else if (waveActive) {
        ctx.fillStyle = '#4ade80';
      } else {
        ctx.fillStyle = '#333';
      }

      ctx.fillRect(x + 1, y, barW - 2, h);
    }

    offset += 0.3;

    if (label) {
      if (waveMuted) {
        label.textContent = 'Filtering';
        label.style.color = '#e94560';
      } else if (waveActive) {
        label.textContent = 'Listening';
        label.style.color = '#4ade80';
      } else {
        label.textContent = 'Inactive';
        label.style.color = '#666';
      }
    }

    requestAnimationFrame(draw);
  }
  draw();
}

// Poll capture status to update waveform
function pollWaveState() {
  chrome.runtime.sendMessage({action: 'getCaptureStatus'}, (resp) => {
    void chrome.runtime.lastError;
    waveActive = !!(resp && resp.active);
  });
  // Check if currently muting via content script
  chrome.tabs.query({active:true, currentWindow:true}, (tabs) => {
    if (!tabs || !tabs[0]) return;
    chrome.tabs.get(tabs[0].id, (tab) => {
      if (chrome.runtime.lastError) return;
      waveMuted = !!(tab && tab.mutedInfo && tab.mutedInfo.muted);
    });
  });
}
setInterval(pollWaveState, 200);

document.addEventListener('DOMContentLoaded', () => {
  fetch(chrome.runtime.getURL('blockedWords.json'))
    .then(r => r.json())
    .then(words => { DEFAULTS.blockedWords = words; })
    .catch(() => {})
    .finally(() => {
      load();
      $('saveBtn').addEventListener('click', save);
      $('captureBtn').addEventListener('click', startCapture);
      $('stopCaptureBtn').addEventListener('click', stopCapture);
      setTimeout(checkStatus, 300);
      startWave();
      pollWaveState();
    });
});
