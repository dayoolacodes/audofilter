// content.js — detects subtitle changes, mutes video, optional censoring.
// Guard against double-injection
if (window.__cleanMuteLoaded) {
  console.log('CleanMute: content script already loaded');
} else {
  window.__cleanMuteLoaded = true;

  /* =====================
     Configuration & state
     ===================== */
  const DEFAULTS = {
    enabled: true,
    blockedWords: [
      'fuck','fucks','fucked','fucker','fuckers','fucking','fuckin',
      'shit','shits','shitted','shitter','shitters','shitting','shitty','shite',
      'bitch','bitches','bitching','bitchy',
      'damn','damned','damning',
      'hell','hells','hellish',
      'ass','asses','asshole','assholes','assfuck','assfucked','assfucker','assfucking','asswipe',
      'motherfuck','motherfucks','motherfucked','motherfucker','motherfuckers','motherfucking',
      'crap','crappy','crapping','craps',
      'piss','pissed','pissing','pissers',
      'motherfucker','motherfucking',
      'dick','dicks','dickhead','dickheads',
      'cock','cocks','cocksucker','cocksucking',
      'tit','tits','titty','titties',
      'twat','twats',
      'whore','whores','whoring',
      'slut','sluts','slutting',
      'bloody','bollocks','bugger','buggering',
      'bastard','bastards'
    ],
    muteDuration: 1500,
    censor: true,
    debounceMs: 2000,
    testMode: false
  };

  let settings = {};
  let debounceMap = new Map(); // element-word-text -> lastTriggeredTime
  let currentMuteTimers = new Map(); // video -> { restoreId, prevMuted, expiresAt }
  let originalTextStore = new WeakMap(); // element -> originalText
  let scheduledCueTimers = new Map(); // key -> timeoutId for scheduled pre-mute
  let attachedTracks = new WeakSet(); // textTrack -> attached flag
  let subtitleElementIds = new WeakMap(); // element -> unique id
  let nextSubtitleElementId = 1;

  /* ================
     Utility functions
     ================ */
  function log(...args) { console.log('CleanMute:', ...args); }

  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function now() { return Date.now(); }

  function getSubtitleElementId(el) {
    if (!subtitleElementIds.has(el)) {
      subtitleElementIds.set(el, `cleanmute-el-${nextSubtitleElementId++}`);
    }
    return subtitleElementIds.get(el);
  }

  function loadSettings(callback) {
    chrome.storage.sync.get(DEFAULTS, (items) => {
      settings = Object.assign({}, DEFAULTS, items);
      log('Loaded settings', settings);
      if (callback) callback();
    });
  }

  function isVisible(el) {
    if (!el || !(el.getBoundingClientRect)) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    if (r.bottom < 0 || r.top > (window.innerHeight || document.documentElement.clientHeight)) return false;
    // avoid elements off-screen or hidden
    const style = window.getComputedStyle(el);
    if (style && (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0')) return false;
    return true;
  }

  // Choose the largest visible playing video element on the page
  function findLargestVisibleVideo() {
    const videos = Array.from(document.querySelectorAll('video')).filter(isVisible);
    if (videos.length === 0) return null;
    // Prefer playing videos
    const playing = videos.filter(v => !v.paused && !v.ended);
    const candidates = playing.length ? playing : videos;
    let best = null;
    let bestArea = 0;
    for (const v of candidates) {
      const r = v.getBoundingClientRect();
      const area = Math.max(0, r.width) * Math.max(0, r.height);
      if (area > bestArea) {
        bestArea = area;
        best = v;
      }
    }
    return best;
  }

  // Mask a blocked word preserving length
  function maskWord(word) {
    return '*'.repeat(word.length);
  }

  function replaceBlockedInHtml(html, blockedList) {
    let out = html;
    for (const w of blockedList) {
      const regex = new RegExp('\\b' + escapeRegExp(w) + '\\b', 'gi');
      out = out.replace(regex, (m) => maskWord(m));
    }
    return out;
  }

  /* =========================
     Muting / restoration logic
     ========================= */
  function muteVideoForDuration(video, duration, reason) {
    if (!video) return;
    try {
      const nowMs = Date.now();
      const existing = currentMuteTimers.get(video);
      const prevMuted = existing ? existing.prevMuted : video.muted;
      let remainingMs = 0;
      if (existing && existing.expiresAt) {
        remainingMs = Math.max(0, existing.expiresAt - nowMs);
      }
      const effectiveDuration = Math.max(duration, remainingMs);
      log('Muting video for', duration, 'ms — reason:', reason, 'prevMuted:', prevMuted, 'remainingMs:', remainingMs);
      if (existing) {
        clearTimeout(existing.restoreId);
        currentMuteTimers.delete(video);
      }
      video.muted = true;
      const expiresAt = nowMs + effectiveDuration;
      const restoreId = setTimeout(() => {
        try {
          if (!prevMuted) {
            video.muted = false;
            log('Restored video mute to false');
          } else {
            log('Video was previously muted; leaving muted state as-is');
          }
        } catch (e) {
          log('Error restoring video mute', e);
        }
        currentMuteTimers.delete(video);
      }, effectiveDuration);
      currentMuteTimers.set(video, { restoreId, prevMuted, expiresAt });
    } catch (e) {
      log('Error muting video', e);
    }
  }

  /* =============================
     textTracks / cuechange support
     Best-effort: attach to video.textTracks and schedule pre-mute
     ============================= */
  const PRE_MUTE_LEAD_MS = 250; // mute this many ms before cue.startTime

  function cueKeyFor(cue, track, video) {
    // make a reasonably unique key for a cue
    return (video && video.currentSrc ? video.currentSrc : '') + '::' + (track && track.language ? track.language : '') + '::' + cue.startTime + '::' + cue.text;
  }

  const TEXT_TRACK_LOOKAHEAD_MS = 12000;

  function isBlockedCueText(text) {
    const lower = (text || '').toString().toLowerCase();
    for (const w of settings.blockedWords || []) {
      if (!w) continue;
      const regex = new RegExp('\\b' + escapeRegExp(w.trim()) + '\\b', 'i');
      if (regex.test(lower)) return w;
    }
    return null;
  }

  function scheduleCueMute(video, track, cue, blockedWord) {
    const key = cueKeyFor(cue, track, video);
    if (scheduledCueTimers.has(key)) return;

    const nowMs = video.currentTime * 1000;
    const cueStartMs = cue.startTime * 1000;
    const msUntilStart = cueStartMs - nowMs - PRE_MUTE_LEAD_MS;
    const schedule = Math.max(0, msUntilStart);
    log('Scheduling pre-mute for blocked cue', blockedWord, 'start in', msUntilStart, 'ms', 'key', key);

    const toId = setTimeout(() => {
      try {
        muteVideoForDuration(video, settings.muteDuration || DEFAULTS.muteDuration, 'textTrack:' + blockedWord);
      } catch (e) {
        log('Error during scheduled pre-mute', e);
      }
      scheduledCueTimers.delete(key);
    }, schedule);

    scheduledCueTimers.set(key, toId);
    setTimeout(() => {
      if (scheduledCueTimers.has(key)) {
        clearTimeout(scheduledCueTimers.get(key));
        scheduledCueTimers.delete(key);
      }
    }, (cue.duration || 5000) + 10000);
  }

  function scanTrackForBlockedCues(video, track) {
    if (!track || !track.cues || !video) return;
    const nowMs = video.currentTime * 1000;
    const maxMs = nowMs + TEXT_TRACK_LOOKAHEAD_MS;
    const cues = Array.from(track.cues || []);
    for (const cue of cues) {
      if (!cue || !cue.text) continue;
      const cueStartMs = cue.startTime * 1000;
      const cueEndMs = cue.endTime * 1000;
      if (cueEndMs < nowMs - 500) continue;
      if (cueStartMs > maxMs) continue;

      const blockedWord = isBlockedCueText(cue.text);
      if (!blockedWord) continue;
      scheduleCueMute(video, track, cue, blockedWord);
    }
  }

  function handleTrackCueChange(video, track) {
    try {
      scanTrackForBlockedCues(video, track);
    } catch (e) {
      log('handleTrackCueChange error', e);
    }
  }

  function attachTextTrackHandlers(video) {
    if (!video || !video.textTracks) return;
    for (let i = 0; i < video.textTracks.length; i++) {
      const track = video.textTracks[i];
      if (!track || attachedTracks.has(track)) continue;
      const listener = () => handleTrackCueChange(video, track);
      try {
        track.addEventListener('cuechange', listener);
        attachedTracks.add(track);
        log('Attached cuechange listener to textTrack', track.language || 'unknown');
      } catch (e) {
        try {
          track.oncuechange = listener;
          attachedTracks.add(track);
          log('Attached oncuechange fallback');
        } catch (er) {
          log('Could not attach to textTrack', er);
        }
      }
      scanTrackForBlockedCues(video, track);
    }
  }

  function attachToExistingVideos() {
    const vids = Array.from(document.querySelectorAll('video'));
    for (const v of vids) attachTextTrackHandlers(v);
  }

  // periodically attempt to attach to new videos
  setInterval(() => { attachToExistingVideos(); }, 2000);

  /* =====================
     Subtitle detection
     ===================== */
  const KNOWN_SELECTORS = [
    '[data-uia*="subtitle"]',
    '[data-uia*="caption"]',
    '.player-timedtext',
    '.atvwebplayersdk-captions-text',
    '.atvwebplayersdk-captions-content',
    '.atvwebplayersdk-caption-text',
    '.caption',
    '.captions',
    '.caption-text',
    '.playerCaptions',
    '.timedtext'
  ];

  function collectFromRoot(root, found) {
    if (!root) return;
    try {
      for (const sel of KNOWN_SELECTORS) {
        const nodes = (root.querySelectorAll ? root.querySelectorAll(sel) : []);
        nodes.forEach(el => found.add(el));
      }
      if (root.querySelectorAll) {
        const all = root.querySelectorAll('*');
        for (const child of all) {
          if (child.shadowRoot) {
            collectFromRoot(child.shadowRoot, found);
          }
        }
      }
    } catch (e) {
      // Some shadow roots or cross-origin frames may be inaccessible
    }
  }

  function isLikelySubtitleElement(el) {
    if (!isVisible(el)) return false;
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'NOSCRIPT') return false;
    const text = (el.innerText || el.textContent || '').trim();
    if (!text) return false;
    const len = text.length;
    const lines = text.split(/\r?\n/).filter(Boolean).length;
    if (len > 180 || len < 1 || lines > 3) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 10) return false;
    const role = el.getAttribute && (el.getAttribute('role') || '').toLowerCase();
    if (role === 'status' || role === 'alert' || role === 'log') return true;
    const className = (el.className || '').toString().toLowerCase();
    if (className.includes('subtitle') || className.includes('caption') || className.includes('captions') || className.includes('timedtext')) return true;
    const bottomCenter = rect.top + rect.height / 2;
    if (bottomCenter > window.innerHeight * 0.7 && rect.bottom > window.innerHeight * 0.85) return true;
    return false;
  }

  function findSubtitleCandidates() {
    const found = new Set();
    collectFromRoot(document, found);

    if (!found.size) {
      // Fallback: scan visible elements only when no known subtitle containers are found.
      const all = Array.from(document.querySelectorAll('body *'));
      for (const el of all) {
        try {
          if (isLikelySubtitleElement(el)) {
            found.add(el);
          }
        } catch (e) { /* ignore inaccessibles */ }
      }
    }
    const candidates = Array.from(found).filter(el => isVisible(el) && isLikelySubtitleElement(el));
    if (!candidates.length) {
      log('CleanMute: no subtitle candidates found');
    }
    return candidates;
  }

  function scanAndProcess() {
    if (!settings.enabled) return;
    const subtitleEls = findSubtitleCandidates();
    if (!subtitleEls.length) return;
    const blocked = settings.blockedWords || [];
    if (!blocked.length) return;
    for (const el of subtitleEls) {
      const text = (el.innerText || el.textContent || '').trim();
      if (!text) continue;
      const lower = text.toLowerCase();
      for (const w of blocked) {
        const wTrim = w.trim();
        if (!wTrim) continue;
        const regex = new RegExp('\\b' + escapeRegExp(wTrim) + '\\b', 'i');
        if (!regex.test(lower)) continue;

        const elementId = getSubtitleElementId(el);
        const matchKey = `${elementId}::${wTrim.toLowerCase()}::${lower}`;
        const last = debounceMap.get(matchKey) || 0;
        if (now() - last < (settings.debounceMs || DEFAULTS.debounceMs)) {
          // debounced for this exact subtitle element + word + text
          continue;
        }

        debounceMap.set(matchKey, now());
        log('Detected blocked word', wTrim, 'in text:', text);

        const video = findLargestVisibleVideo();
        if (video) {
          muteVideoForDuration(video, settings.muteDuration || DEFAULTS.muteDuration, wTrim);
        } else {
          log('No video found to mute');
        }

        if (settings.censor) {
          try {
            if (!originalTextStore.has(el)) {
              originalTextStore.set(el, el.innerHTML);
            }
            el.innerHTML = replaceBlockedInHtml(el.innerHTML, blocked);
            setTimeout(() => {
              try {
                const orig = originalTextStore.get(el);
                if (orig !== undefined) {
                  el.innerHTML = orig;
                  originalTextStore.delete(el);
                }
              } catch (e) { log('Error restoring original subtitle', e); }
            }, settings.muteDuration || DEFAULTS.muteDuration);
          } catch (e) { log('Error censoring subtitle', e); }
        }

        // once we matched a blocked word in this element, don't check other words for same element in this scan
        break;
      }
    }
  }

  /* ==================
     Mutation observation
     ================== */
  let observer = null;
  function startObserving() {
    if (observer) return;
    observer = new MutationObserver((mutations) => {
      try {
        scanAndProcess();
      } catch (e) { log('Observer error', e); }
    });
    observer.observe(document.documentElement || document.body, { childList: true, subtree: true, characterData: true });
    log('Started MutationObserver for subtitles');
    // initial scan
    setTimeout(scanAndProcess, 500);
    // attach to any textTracks we can find
    setTimeout(attachToExistingVideos, 800);
  }

  function stopObserving() {
    if (!observer) return;
    observer.disconnect();
    observer = null;
    log('Stopped observing');
  }

  /* ==============
     Demo / Test Mode
     ============== */
  let demoInterval = null;
  function createDemoSubtitle(text) {
    // add a simple subtitle-like div at bottom for testing
    let demo = document.getElementById('cleanmute-demo-subtitle');
    if (!demo) {
      demo = document.createElement('div');
      demo.id = 'cleanmute-demo-subtitle';
      demo.style.position = 'fixed';
      demo.style.left = '50%';
      demo.style.transform = 'translateX(-50%)';
      demo.style.bottom = '8%';
      demo.style.background = 'rgba(0,0,0,0.7)';
      demo.style.color = 'white';
      demo.style.padding = '8px 12px';
      demo.style.fontSize = '20px';
      demo.style.borderRadius = '4px';
      demo.style.zIndex = 2147483647;
      demo.style.textAlign = 'center';
      demo.style.maxWidth = '90%';
      document.body.appendChild(demo);
    }
    demo.innerText = text || 'Demo subtitle — safe text.';
    // ensure demo is found by findSubtitleCandidates via visibility and bottom placement
  }

  function startDemoCycler() {
    if (demoInterval) return;
    const samples = [];
    if (!samples.length) return;
    let i = 0;
    createDemoSubtitle(samples[0]);
    demoInterval = setInterval(() => {
      i = (i + 1) % samples.length;
      createDemoSubtitle(samples[i]);
    }, 2500);
  }

  function stopDemoCycler() {
    if (demoInterval) clearInterval(demoInterval);
    demoInterval = null;
    const demo = document.getElementById('cleanmute-demo-subtitle');
    if (demo) demo.remove();
  }

  /* ======================
     Message handling (from popup)
     ====================== */
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.action) return;
    if (msg.action === 'reloadSettings') {
      loadSettings(() => { sendResponse({ok:true}); startObserving(); });
      return true; // async
    }
    if (msg.action === 'createDemo') {
      startDemoCycler();
      sendResponse({ok:true});
    }
    if (msg.action === 'stopDemo') {
      stopDemoCycler();
      sendResponse({ok:true});
    }
  });

  /* =============
     Initialization
     ============= */
  loadSettings(() => {
    // remove any leftover demo subtitle element from prior runs
    try {
      const d = document.getElementById('cleanmute-demo-subtitle');
      if (d) d.remove();
    } catch (e) {}

    if (settings.testMode) startDemoCycler();
    if (settings.enabled) startObserving(); else stopObserving();
    // Also rescan once a while in case observers miss something
    setInterval(() => { if (settings.enabled) scanAndProcess(); }, 3000);
  });

}
