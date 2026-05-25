// background.js — manages audio capture mode and fallback tab muting
self.addEventListener('install', () => {});
self.addEventListener('activate', () => {});

let muteTimers = {};
let captureTabId = null;
let captureActive = false;

// ---- Offscreen document management ----

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Audio processing for profanity filter'
  });
}

// ---- Start audio capture mode ----

async function startCapture(tabId) {
  if (captureActive && captureTabId === tabId) return { ok: true, mode: 'capture' };

  try {
    await stopCapture();
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    await ensureOffscreen();

    const data = await chrome.storage.sync.get({ blockedWords: [] });
    let words = data.blockedWords;
    if (!words.length) {
      // Load defaults from blockedWords.json
      try {
        const resp = await fetch(chrome.runtime.getURL('blockedWords.json'));
        words = await resp.json();
      } catch (e) {}
    }

    chrome.runtime.sendMessage({
      action: 'offscreen-start',
      streamId: streamId,
      blockedWords: words
    }, () => { void chrome.runtime.lastError; });

    captureTabId = tabId;
    captureActive = true;

    // Mute the tab so user only hears our delayed audio
    chrome.tabs.update(tabId, { muted: true });

    return { ok: true, mode: 'capture' };
  } catch (e) {
    captureActive = false;
    return { ok: false, error: e.message };
  }
}

async function stopCapture() {
  if (captureTabId) {
    try { chrome.tabs.update(captureTabId, { muted: false }); } catch (e) {}
  }
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (contexts.length > 0) {
      chrome.runtime.sendMessage({ action: 'offscreen-stop' }, () => { void chrome.runtime.lastError; });
      await chrome.offscreen.closeDocument();
    }
  } catch (e) {}
  captureActive = false;
  captureTabId = null;
}

// ---- Fallback: tab muting ----

function fallbackMute(tabId, duration) {
  if (muteTimers[tabId]) {
    clearTimeout(muteTimers[tabId].restoreId);
  }
  chrome.tabs.update(tabId, { muted: true });
  const restoreId = setTimeout(() => {
    chrome.tabs.update(tabId, { muted: false });
    delete muteTimers[tabId];
  }, duration);
  muteTimers[tabId] = { restoreId };
}

// ---- Message handling ----

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.action) { sendResponse({ ok: true }); return; }

  // Content script requesting tab mute (fallback mode)
  if (msg.action === 'muteTab') {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) { sendResponse({ ok: false }); return; }
    fallbackMute(tabId, msg.duration || 700);
    sendResponse({ ok: true, mode: 'fallback' });
    return;
  }

  // Popup requesting capture mode start
  if (msg.action === 'startCapture') {
    const tabId = msg.tabId;
    if (!tabId) { sendResponse({ ok: false }); return; }
    startCapture(tabId).then(r => sendResponse(r));
    return true; // async
  }

  // Popup requesting capture mode stop
  if (msg.action === 'stopCapture') {
    stopCapture().then(() => sendResponse({ ok: true }));
    return true;
  }

  // Offscreen reporting status
  if (msg.action === 'offscreen-ready') {
    sendResponse({ ok: true });
    return;
  }
  if (msg.action === 'offscreen-error') {
    // Capture failed — unmute tab and fall back
    if (captureTabId) chrome.tabs.update(captureTabId, { muted: false });
    captureActive = false;
    sendResponse({ ok: true });
    return;
  }

  // Status query
  if (msg.action === 'getCaptureStatus') {
    sendResponse({ active: captureActive, tabId: captureTabId });
    return;
  }

  sendResponse({ ok: true });
});

// Clean up on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === captureTabId) stopCapture();
  if (muteTimers[tabId]) {
    clearTimeout(muteTimers[tabId].restoreId);
    delete muteTimers[tabId];
  }
});
