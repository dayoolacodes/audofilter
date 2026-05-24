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
    });
});
