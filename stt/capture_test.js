// capture_test.js
// Try to capture audio from the largest visible video element via captureStream()
(function(){
  if (window.CleanMuteCapture && window.CleanMuteCapture._installed) return;
  const log = (...a) => console.log('CleanMuteCapture:', ...a);

  async function testCapture(durationMs = 3000) {
    const video = (Array.from(document.querySelectorAll('video')).filter(v=>v.offsetParent !== null)[0]) || document.querySelector('video');
    if (!video) { log('No video element found on page'); return { ok:false, reason:'no-video' }; }
    log('Found video', video);
    let stream = null;
    try {
      if (video.captureStream) {
        stream = video.captureStream();
        log('captureStream() produced', stream);
      } else if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
        log('captureStream not available; falling back to getDisplayMedia (will prompt user)');
        stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: false });
      } else {
        log('No capture API available');
        return { ok:false, reason:'no-capture-api' };
      }
    } catch (e) {
      log('Error obtaining stream', e);
      return { ok:false, reason:'capture-error', error:e };
    }

    if (!stream) return { ok:false, reason:'no-stream' };

    try {
      const recorder = new MediaRecorder(stream);
      const parts = [];
      recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size) parts.push(ev.data); };
      recorder.start();
      log('Recording for', durationMs, 'ms');
      await new Promise(r => setTimeout(r, durationMs));
      recorder.stop();
      await new Promise(r => recorder.onstop = r);
      const blob = new Blob(parts, { type: 'audio/webm' });
      const url = URL.createObjectURL(blob);
      log('Recorded blob URL', url);
      const a = document.createElement('audio'); a.controls = true; a.src = url; a.style.position='fixed'; a.style.right='10px'; a.style.bottom='10px'; a.style.zIndex=2147483647; document.body.appendChild(a);
      return { ok:true, blobUrl: url };
    } catch (e) {
      log('Error recording stream', e);
      return { ok:false, reason:'record-error', error:e };
    } finally {
      // stop tracks if we requested getDisplayMedia fallback
      try { stream.getTracks().forEach(t=>t.stop()); } catch (e) {}
    }
  }

  window.CleanMuteCapture = window.CleanMuteCapture || {};
  window.CleanMuteCapture.testCapture = testCapture;
  window.CleanMuteCapture._installed = true;
  log('capture_test loaded — use CleanMuteCapture.testCapture()');
})();
