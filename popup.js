// popup.js — manage UI and settings
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
  });
}

function setStatus(text) {
  const el = $('status');
  el.textContent = text || '';
}

function checkMode() {
  chrome.tabs.query({active:true, currentWindow:true}, (tabs) => {
    if (!tabs || !tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, {action:'getStatus'}, (resp) => {
      if (chrome.runtime.lastError || !resp) {
        setStatus('Not active on this page');
        return;
      }
      if (resp.mode === 'subtitle-file') {
        setStatus('Mode: Subtitle file (precise) — ' + resp.mutePoints + ' mute points');
      } else {
        setStatus('Mode: DOM scan (fallback)');
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  load();
  $('saveBtn').addEventListener('click', save);
  setTimeout(checkMode, 500);
});
