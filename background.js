// background.js — manages tab capture, offscreen document, and fallback tab muting

let activeTabId = null;
let offscreenReady = false;
let usingPreciseMute = false;

// Fallback tab mute timers (used when precise mode isn't active)
let muteTimers = {};

const BLOCKED_WORDS_DEFAULT = [
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
];

self.addEventListener('install', () => {});
self.addEventListener('activate', () => {});

// --- Offscreen document management ---

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  if (contexts.length > 0) return true;

  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Audio processing for profanity filter'
    });
    return true;
  } catch (e) {
    return false;
  }
}

async function closeOffscreen() {
  try {
    await chrome.offscreen.closeDocument();
  } catch (e) {}
  offscreenReady = false;
  usingPreciseMute = false;
}

// --- Start precise muting on a tab ---

async function startPreciseMode(tabId) {
  if (activeTabId === tabId && usingPreciseMute) return;

  // Stop any previous capture
  await stopPreciseMode();

  try {
    // Get the stream ID for the tab
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });

    // Ensure offscreen document exists
    const ready = await ensureOffscreen();
    if (!ready) return;

    // Get blocked words from storage
    const data = await chrome.storage.sync.get({ blockedWords: BLOCKED_WORDS_DEFAULT });

    // Send to offscreen to start audio pipeline
    chrome.runtime.sendMessage({
      action: 'startCapture',
      streamId: streamId,
      blockedWords: data.blockedWords
    });

    activeTabId = tabId;
    usingPreciseMute = true;

    // Mute the tab's original audio so user only hears our delayed version
    chrome.tabs.update(tabId, { muted: true });
  } catch (e) {
    // tabCapture failed (likely DRM) — fall back to tab muting
    usingPreciseMute = false;
  }
}

async function stopPreciseMode() {
  if (activeTabId && usingPreciseMute) {
    // Unmute original tab audio
    chrome.tabs.update(activeTabId, { muted: false });
    chrome.runtime.sendMessage({ action: 'stopCapture' });
  }
  activeTabId = null;
  usingPreciseMute = false;
}

// --- Fallback tab mute (subtitle-based, from content script) ---

function fallbackTabMute(tabId, duration) {
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

// --- Message handling ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.action) {
    sendResponse({ ok: true });
    return;
  }

  if (msg.action === 'muteTab') {
    // From content script — use fallback if precise mode isn't active
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) { sendResponse({ ok: false }); return; }

    if (usingPreciseMute && activeTabId === tabId) {
      // Precise mode handles muting via offscreen GainNode
      sendResponse({ ok: true, mode: 'precise' });
      return;
    }

    fallbackTabMute(tabId, msg.duration || 700);
    sendResponse({ ok: true, mode: 'fallback' });
    return;
  }

  if (msg.action === 'startPreciseMode') {
    const tabId = sender.tab ? sender.tab.id : msg.tabId;
    if (tabId) startPreciseMode(tabId);
    sendResponse({ ok: true });
    return;
  }

  if (msg.action === 'stopPreciseMode') {
    stopPreciseMode();
    sendResponse({ ok: true });
    return;
  }

  if (msg.action === 'captureStarted') {
    offscreenReady = true;
    sendResponse({ ok: true });
    return;
  }

  if (msg.action === 'captureError') {
    // Capture failed — fall back to subtitle-based muting
    usingPreciseMute = false;
    if (activeTabId) {
      chrome.tabs.update(activeTabId, { muted: false });
    }
    sendResponse({ ok: true });
    return;
  }

  sendResponse({ ok: true });
});

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeTabId) {
    stopPreciseMode();
    closeOffscreen();
  }
  if (muteTimers[tabId]) {
    clearTimeout(muteTimers[tabId].restoreId);
    delete muteTimers[tabId];
  }
});
