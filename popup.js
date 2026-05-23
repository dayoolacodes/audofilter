// popup.js — manage UI, settings, and test injection
const DEFAULTS = {
  enabled: true,
  blockedWords: [
    'fuck','fucks','fucked','fucker','fuckers','fucking','fuckin',
    'motherfuck','motherfucks','motherfucked','motherfucker','motherfuckers','motherfucking'
  ],
  muteDuration: 1500,
  censor: true,
  testMode: false,
  preMuteLeadMs: 250
};

function $(id) { return document.getElementById(id); }

function load() {
  chrome.storage.sync.get(DEFAULTS, (items) => {
    $('enableFilter').checked = items.enabled;
    $('blockedWords').value = (items.blockedWords || []).join('\n');
    $('muteDuration').value = items.muteDuration || DEFAULTS.muteDuration;
    $('censorToggle').checked = items.censor;
    $('preMuteLead').value = items.preMuteLeadMs || DEFAULTS.preMuteLeadMs;
    setStatus('Settings loaded');
  });
}

function save() {
  const blocked = $('blockedWords').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const data = {
    enabled: $('enableFilter').checked,
    blockedWords: blocked,
    muteDuration: parseInt($('muteDuration').value,10) || DEFAULTS.muteDuration,
    censor: $('censorToggle').checked,
    preMuteLeadMs: parseInt($('preMuteLead').value,10) || DEFAULTS.preMuteLeadMs
  };
  chrome.storage.sync.set(data, () => {
    setStatus('Saved');
    // notify content script to reload settings (if present)
    chrome.tabs.query({active:true, currentWindow:true}, (tabs) => {
      if (!tabs || !tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, {action:'reloadSettings'}, () => {
        void chrome.runtime.lastError;
      });
    });
  });
}

function setStatus(text) {
  const el = $('status');
  el.textContent = text || '';
}

function injectDemo() {
  // If content script is already present on this tab, ask it to create demo.
  chrome.tabs.query({active:true, currentWindow:true}, (tabs) => {
    if (!tabs || !tabs[0]) return;
    const tabId = tabs[0].id;
    // try sendMessage first
    chrome.tabs.sendMessage(tabId, {action:'createDemo'}, (resp) => {
      if (chrome.runtime.lastError) {
        // content script not present — inject it programmatically then message
        // content script not present, injecting
        chrome.scripting.executeScript({
          target: {tabId},
          files: ['content.js']
        }, () => {
          // after injection, ask it to create demo
          chrome.tabs.sendMessage(tabId, {action:'createDemo'}, () => {
            setStatus('Demo injected');
          });
        });
      } else {
        setStatus('Demo requested');
      }
    });
  });
}

function stopDemo() {
  chrome.tabs.query({active:true, currentWindow:true}, (tabs) => {
    if (!tabs || !tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, {action:'stopDemo'}, (resp) => {
      if (chrome.runtime.lastError) {
        setStatus('No demo running or content script not present');
      } else setStatus('Stopped demo');
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  load();
  $('saveBtn').addEventListener('click', save);
  $('testBtn').addEventListener('click', injectDemo);
  $('stopTestBtn').addEventListener('click', stopDemo);
});
