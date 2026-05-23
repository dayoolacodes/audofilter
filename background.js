// background.js — handles tab muting on behalf of content script
self.addEventListener('install', () => {});
self.addEventListener('activate', () => {});

let muteTimers = {};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.action) {
    sendResponse({ok:true});
    return;
  }

  if (msg.action === 'muteTab') {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) { sendResponse({ok:false}); return; }
    const duration = msg.duration || 700;

    if (muteTimers[tabId]) {
      clearTimeout(muteTimers[tabId].restoreId);
    }

    chrome.tabs.update(tabId, { muted: true });

    const restoreId = setTimeout(() => {
      chrome.tabs.update(tabId, { muted: false });
      delete muteTimers[tabId];
    }, duration);

    muteTimers[tabId] = { restoreId };
    sendResponse({ok:true});
    return;
  }

  sendResponse({ok:true});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (muteTimers[tabId]) {
    clearTimeout(muteTimers[tabId].restoreId);
    delete muteTimers[tabId];
  }
});
