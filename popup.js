// popup.js — manage UI, settings, and precise mute control
const DEFAULTS = {
  enabled: true,
  blockedWords: [
    'fuck','fucks','fucked','fucker','fuckers','fucking','fuckin','fuckface',
    'fuckwit','fuckwits','fuckhead','fuckheads','fuckboy','fuckboys',
    'fuckup','fuckups','fuckall','fuckery','fuckeries',
    'motherfuck','motherfucks','motherfucked','motherfucker','motherfuckers','motherfucking',
    'clusterfuck','clusterfucks','clusterfucked',
    'mindfuck','mindfucks','mindfucked',
    'brainfuck','skullfuck','ratfuck','batfuck',
    'unfucking','unfucked',
    'nigga','niggas','nigger','niggers',
    'dick','dicks','dickhead','dickheads',
    'pussy','pussies',
    'asshole','assholes',
    'shit','shits','shitting','shitty',
    'bitch','bitches'
  ],
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
    setStatus('Settings loaded');
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
    // Also update offscreen blocked words if running
    chrome.runtime.sendMessage({action: 'updateBlockedWords', blockedWords: blocked}, () => {
      void chrome.runtime.lastError;
    });
  });
}

function setStatus(text) {
  const el = $('status');
  el.textContent = text || '';
}

function startPreciseMute() {
  chrome.tabs.query({active:true, currentWindow:true}, (tabs) => {
    if (!tabs || !tabs[0]) { setStatus('No active tab'); return; }
    chrome.runtime.sendMessage({action: 'startPreciseMode', tabId: tabs[0].id}, (resp) => {
      if (chrome.runtime.lastError) {
        setStatus('Error: ' + chrome.runtime.lastError.message);
      } else {
        setStatus('Precise mute activated — audio delayed ~400ms');
      }
    });
  });
}

function stopPreciseMute() {
  chrome.runtime.sendMessage({action: 'stopPreciseMode'}, (resp) => {
    if (chrome.runtime.lastError) {
      setStatus('Error: ' + chrome.runtime.lastError.message);
    } else {
      setStatus('Precise mute stopped');
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  load();
  $('saveBtn').addEventListener('click', save);
  $('preciseMuteBtn').addEventListener('click', startPreciseMute);
  $('stopPreciseBtn').addEventListener('click', stopPreciseMute);
});
