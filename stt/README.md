# CleanMute STT/TTS Prototypes

This folder contains quick prototypes and notes to evaluate speech-to-text (STT) and text-to-speech (TTS) options for CleanMute.

Files:
- `mic_prototype.js` — small content-script-friendly wrapper for the Web Speech API (microphone STT).
- `capture_test.js` — utility to test `video.captureStream()` feasibility and record a short snippet via `MediaRecorder`.
- `whisper_notes.md` — notes and integration guidance for a WebAssembly Whisper build.
- `cloud_notes.md` — notes for integrating cloud STT providers (Google/Azure/Whisper API) and privacy considerations.

How to test quickly:
1. Open devtools Console on a page with a video.
2. Paste the contents of `mic_prototype.js` to enable `window.CleanMuteSTT.startMicSTT()` and `stopMicSTT()`.
3. Paste `capture_test.js` and run `CleanMuteCapture.testCapture()` to try capturing the largest video element.

Notes:
- DRM-protected streams may block `captureStream()`; test on a non-DRM sample first.
- Web Speech API (microphone) can't directly capture tab audio; it requires recording the tab and/or routing audio to a MediaStream that is then provided to an STT engine.

Privacy:
- Cloud STT requires explicit opt-in and API keys; Whisper WASM is local but heavy.
