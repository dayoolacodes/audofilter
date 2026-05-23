// content.js — intercepts subtitle files, parses timing, pre-schedules mutes.
if (window.__cleanMuteLoaded) {
  // already loaded
} else {
  window.__cleanMuteLoaded = true;

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
    debounceMs: 2000,
    testMode: false
  };

  let settings = {};
  let allMutePoints = []; // { timeMs, durationMs, word } — pre-computed from subtitle files
  let scheduledTimers = new Map(); // key -> timeoutId
  let lastScheduleTime = 0;
  let subtitleIntercepted = false;

  // ---- Fallback: DOM-based detection state ----
  let debounceMap = new Map();
  let subtitleElementIds = new WeakMap();
  let nextSubtitleElementId = 1;

  function log(...args) { /* silent */ }
  function now() { return Date.now(); }

  function loadSettings(callback) {
    chrome.storage.sync.get(DEFAULTS, (items) => {
      settings = Object.assign({}, DEFAULTS, items);
      if (callback) callback();
    });
  }

  function muteTabForDuration(duration, reason) {
    try {
      chrome.runtime.sendMessage({ action: 'muteTab', duration }, () => {
        void chrome.runtime.lastError;
      });
    } catch (e) {}
  }

  // ==========================
  // Subtitle file interception
  // ==========================

  function findBlockedWordInText(text) {
    const lower = (text || '').toString().toLowerCase().replace(/<[^>]*>/g, '');
    if (!lower) return null;
    let tokens = [];
    try {
      tokens = lower.match(/\p{L}+/gu) || [];
    } catch (e) {
      tokens = lower.match(/[A-Za-zÀ-ÖØ-öø-ÿ]+/g) || [];
    }
    if (!tokens.length) return null;
    const blocked = settings.blockedWords || [];
    for (const w of blocked) {
      if (!w) continue;
      const wl = w.trim().toLowerCase();
      for (let i = 0; i < tokens.length; i++) {
        if (tokens[i] === wl) return { word: w, index: i, totalWords: tokens.length };
      }
    }
    return null;
  }

  // Parse TTML (used by Amazon Prime Video)
  function parseTTML(text) {
    const cues = [];
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/xml');
      const ps = doc.querySelectorAll('p[begin][end]');
      for (const p of ps) {
        const begin = parseTTMLTime(p.getAttribute('begin'));
        const end = parseTTMLTime(p.getAttribute('end'));
        const content = p.textContent || '';
        if (begin !== null && end !== null && content.trim()) {
          cues.push({ startTime: begin, endTime: end, text: content.trim() });
        }
      }
    } catch (e) {}
    return cues;
  }

  function parseTTMLTime(str) {
    if (!str) return null;
    // Format: HH:MM:SS.mmm or HH:MM:SS:FF or seconds
    const parts = str.match(/^(\d+):(\d+):(\d+)[.:](\d+)$/);
    if (parts) {
      const h = parseInt(parts[1], 10);
      const m = parseInt(parts[2], 10);
      const s = parseInt(parts[3], 10);
      let ms = parts[4];
      // If 2 digits, treat as frames (~24fps); if 3 digits, milliseconds
      if (ms.length <= 2) {
        ms = Math.round((parseInt(ms, 10) / 24) * 1000);
      } else {
        ms = parseInt(ms, 10);
      }
      return (h * 3600 + m * 60 + s) * 1000 + ms;
    }
    // Try HH:MM:SS format
    const simple = str.match(/^(\d+):(\d+):(\d+)$/);
    if (simple) {
      return (parseInt(simple[1], 10) * 3600 + parseInt(simple[2], 10) * 60 + parseInt(simple[3], 10)) * 1000;
    }
    // Try seconds
    const sec = parseFloat(str);
    if (!isNaN(sec)) return sec * 1000;
    return null;
  }

  // Parse WebVTT
  function parseWebVTT(text) {
    const cues = [];
    try {
      const blocks = text.split(/\n\n+/);
      for (const block of blocks) {
        const lines = block.trim().split('\n');
        for (let i = 0; i < lines.length; i++) {
          const timeMatch = lines[i].match(/(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{3})/);
          if (timeMatch) {
            const startTime = parseVTTTime(timeMatch[1]);
            const endTime = parseVTTTime(timeMatch[2]);
            const content = lines.slice(i + 1).join(' ').replace(/<[^>]*>/g, '').trim();
            if (content) {
              cues.push({ startTime, endTime, text: content });
            }
            break;
          }
        }
      }
    } catch (e) {}
    return cues;
  }

  function parseVTTTime(str) {
    const p = str.replace(',', '.').match(/(\d+):(\d+):(\d+)\.(\d+)/);
    if (!p) return 0;
    return (parseInt(p[1], 10) * 3600 + parseInt(p[2], 10) * 60 + parseInt(p[3], 10)) * 1000 + parseInt(p[4], 10);
  }

  // Process parsed cues into mute points
  function processCues(cues) {
    const points = [];
    const PADDING_MS = 150;
    for (const cue of cues) {
      const match = findBlockedWordInText(cue.text);
      if (!match) continue;

      const cueDurationMs = cue.endTime - cue.startTime;
      const wordFraction = match.index / match.totalWords;
      const wordDuration = cueDurationMs / match.totalWords;

      // Estimate word start time within cue
      const wordStartMs = cue.startTime + (wordFraction * cueDurationMs) - PADDING_MS;
      const muteDuration = wordDuration + (PADDING_MS * 2);

      points.push({
        timeMs: Math.max(0, Math.round(wordStartMs)),
        durationMs: Math.round(muteDuration),
        word: match.word
      });
    }
    return points;
  }

  // Try to detect and parse subtitle content from response text
  function tryParseSubtitles(responseText, url) {
    let cues = [];
    if (responseText.includes('<tt') || responseText.includes('<p begin=')) {
      cues = parseTTML(responseText);
    } else if (responseText.includes('WEBVTT') || responseText.includes('-->')) {
      cues = parseWebVTT(responseText);
    }
    if (cues.length > 0) {
      const points = processCues(cues);
      if (points.length > 0) {
        allMutePoints = allMutePoints.concat(points);
        allMutePoints.sort((a, b) => a.timeMs - b.timeMs);
        subtitleIntercepted = true;
      }
    }
  }

  // Intercept fetch to capture subtitle file responses
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    const result = originalFetch.apply(this, args);
    try {
      const url = (typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : ''));
      // Subtitle URLs typically contain ttml, vtt, subtitle, caption, timedtext
      if (/ttml|vtt|subtitle|caption|timedtext/i.test(url)) {
        result.then(response => {
          const clone = response.clone();
          clone.text().then(text => {
            tryParseSubtitles(text, url);
          }).catch(() => {});
        }).catch(() => {});
      }
    } catch (e) {}
    return result;
  };

  // Intercept XMLHttpRequest too
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__cleanMuteUrl = url || '';
    return originalXHROpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(...args) {
    const url = this.__cleanMuteUrl || '';
    if (/ttml|vtt|subtitle|caption|timedtext/i.test(url)) {
      this.addEventListener('load', function() {
        try {
          if (this.responseText) {
            tryParseSubtitles(this.responseText, url);
          }
        } catch (e) {}
      });
    }
    return originalXHRSend.apply(this, args);
  };

  // =================================
  // Schedule mutes based on video time
  // =================================

  function findVideo() {
    const videos = Array.from(document.querySelectorAll('video'));
    const playing = videos.filter(v => !v.paused && !v.ended);
    if (playing.length) return playing[0];
    return videos[0] || null;
  }

  function scheduleMutes() {
    if (!settings.enabled || !allMutePoints.length) return;
    const video = findVideo();
    if (!video || video.paused) return;

    const currentMs = video.currentTime * 1000;
    const lookAheadMs = 5000;

    for (const point of allMutePoints) {
      if (point.timeMs < currentMs - 1000) continue;
      if (point.timeMs > currentMs + lookAheadMs) break;

      const key = `${point.timeMs}::${point.word}`;
      if (scheduledTimers.has(key)) continue;

      const delay = point.timeMs - currentMs;
      if (delay < -500) continue; // already passed

      const timerId = setTimeout(() => {
        muteTabForDuration(point.durationMs, point.word);
        scheduledTimers.delete(key);
      }, Math.max(0, delay));

      scheduledTimers.set(key, timerId);
    }
  }

  // Clear scheduled timers on seek
  function clearScheduled() {
    for (const [key, id] of scheduledTimers) {
      clearTimeout(id);
    }
    scheduledTimers.clear();
  }

  // Watch for video seeks
  function attachVideoListeners() {
    const video = findVideo();
    if (!video || video.__cleanMuteAttached) return;
    video.__cleanMuteAttached = true;
    video.addEventListener('seeked', () => {
      clearScheduled();
      scheduleMutes();
    });
    video.addEventListener('play', () => {
      scheduleMutes();
    });
  }

  // Periodically schedule upcoming mutes
  setInterval(() => {
    if (!settings.enabled) return;
    attachVideoListeners();
    if (subtitleIntercepted) {
      scheduleMutes();
    }
  }, 500);

  // =================================
  // Fallback: DOM-based subtitle scan
  // (used when subtitle file not intercepted)
  // =================================

  const KNOWN_SELECTORS = [
    '[data-uia*="subtitle"]', '[data-uia*="caption"]',
    '.player-timedtext', '.atvwebplayersdk-captions-text',
    '.atvwebplayersdk-captions-content', '.atvwebplayersdk-caption-text',
    '.caption', '.captions', '.caption-text', '.playerCaptions', '.timedtext'
  ];

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    if (r.bottom < 0 || r.top > (window.innerHeight || document.documentElement.clientHeight)) return false;
    const style = window.getComputedStyle(el);
    if (style && (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0')) return false;
    return true;
  }

  function getSubtitleElementId(el) {
    if (!subtitleElementIds.has(el)) {
      subtitleElementIds.set(el, `cleanmute-el-${nextSubtitleElementId++}`);
    }
    return subtitleElementIds.get(el);
  }

  function collectFromRoot(root, found) {
    if (!root) return;
    try {
      for (const sel of KNOWN_SELECTORS) {
        (root.querySelectorAll ? root.querySelectorAll(sel) : []).forEach(el => found.add(el));
      }
      if (root.querySelectorAll) {
        for (const child of root.querySelectorAll('*')) {
          if (child.shadowRoot) collectFromRoot(child.shadowRoot, found);
        }
      }
    } catch (e) {}
  }

  function isLikelySubtitleElement(el) {
    if (!isVisible(el)) return false;
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'NOSCRIPT') return false;
    const text = (el.innerText || el.textContent || '').trim();
    if (!text || text.length > 180 || text.length < 1) return false;
    const lines = text.split(/\r?\n/).filter(Boolean).length;
    if (lines > 3) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 10) return false;
    const className = (el.className || '').toString().toLowerCase();
    if (className.includes('subtitle') || className.includes('caption') || className.includes('timedtext')) return true;
    const bottomCenter = rect.top + rect.height / 2;
    if (bottomCenter > window.innerHeight * 0.7 && rect.bottom > window.innerHeight * 0.85) return true;
    return false;
  }

  function scanAndProcess() {
    // Skip DOM fallback if we successfully intercepted subtitles
    if (subtitleIntercepted) return;
    if (!settings.enabled) return;

    const found = new Set();
    collectFromRoot(document, found);
    if (!found.size) {
      for (const el of document.querySelectorAll('body *')) {
        try { if (isLikelySubtitleElement(el)) found.add(el); } catch (e) {}
      }
    }
    const candidates = Array.from(found).filter(el => isVisible(el) && isLikelySubtitleElement(el));
    if (!candidates.length) return;

    const blocked = settings.blockedWords || [];
    if (!blocked.length) return;

    for (const el of candidates) {
      const text = (el.innerText || el.textContent || '').trim();
      if (!text) continue;
      const lower = text.toLowerCase();
      if (lower.indexOf('*') !== -1) continue;
      const match = findBlockedWordInText(lower);
      if (!match) continue;
      const wTrim = match.word.trim();
      const elementId = getSubtitleElementId(el);
      const matchKey = `${elementId}::${wTrim.toLowerCase()}::${lower}`;
      const last = debounceMap.get(matchKey) || 0;
      if (now() - last < (settings.debounceMs || DEFAULTS.debounceMs)) continue;
      debounceMap.set(matchKey, now());
      muteTabForDuration(settings.muteDuration || DEFAULTS.muteDuration, wTrim);
      break;
    }
  }

  // MutationObserver for DOM fallback
  let observer = null;
  function startObserving() {
    if (observer) return;
    observer = new MutationObserver(() => {
      try { scanAndProcess(); } catch (e) {}
    });
    observer.observe(document.documentElement || document.body, { childList: true, subtree: true, characterData: true });
    setTimeout(scanAndProcess, 500);
  }

  // ---- Message handling ----
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.action) return;
    if (msg.action === 'reloadSettings') {
      loadSettings(() => {
        // Reprocess intercepted subtitles with new blocked words
        if (subtitleIntercepted) {
          clearScheduled();
          // Re-parse would require keeping raw cues; for now just reload page
        }
        sendResponse({ok:true});
        startObserving();
      });
      return true;
    }
  });

  // ---- Init ----
  loadSettings(() => {
    if (settings.enabled) startObserving();
    setInterval(() => { if (settings.enabled) scanAndProcess(); }, 3000);
  });
}
