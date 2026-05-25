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
    $('filterLabel').textContent = items.enabled ? 'Filtering On' : 'Filtering Off';
    $('filterLabel').style.color = items.enabled ? '#4ade80' : '#666';
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
        setStatus('Subtitle scan active');
      }
    });
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

// Poll status to update waveform
function pollWaveState() {
  chrome.tabs.query({active:true, currentWindow:true}, (tabs) => {
    if (!tabs || !tabs[0]) return;
    // Check if tab is muted (filtering active)
    chrome.tabs.get(tabs[0].id, (tab) => {
      if (chrome.runtime.lastError) return;
      waveMuted = !!(tab && tab.mutedInfo && tab.mutedInfo.muted);
    });
    // Check if content script is running and enabled
    chrome.tabs.sendMessage(tabs[0].id, {action:'getStatus'}, (resp) => {
      if (chrome.runtime.lastError || !resp) {
        waveActive = false;
        return;
      }
      waveActive = !!(resp.enabled);
    });
  });
}
setInterval(pollWaveState, 300);

let saveTimer = null;
function autoSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 500);
}

document.addEventListener('DOMContentLoaded', () => {
  fetch(chrome.runtime.getURL('blockedWords.json'))
    .then(r => r.json())
    .then(words => { DEFAULTS.blockedWords = words; })
    .catch(() => {})
    .finally(() => {
      load();
      // Auto-save on any change
      $('enableFilter').addEventListener('change', () => {
        const on = $('enableFilter').checked;
        $('filterLabel').textContent = on ? 'Filtering On' : 'Filtering Off';
        $('filterLabel').style.color = on ? '#4ade80' : '#666';
        autoSave();
      });
      $('blockedWords').addEventListener('input', autoSave);
      $('muteDuration').addEventListener('input', autoSave);
      $('preMuteLead').addEventListener('input', autoSave);
      setTimeout(checkStatus, 300);
      startWave();
      pollWaveState();
    });
});
