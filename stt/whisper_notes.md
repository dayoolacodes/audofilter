# Whisper (WebAssembly) Integration Notes

Summary:
- Running a local Whisper model (via WebAssembly) inside the extension provides private, high-quality STT but increases bundle size and CPU usage.

Options:
- `ggml` / whisper.cpp with `whisper.wasm` worker builds (smaller models available: tiny, base, small). See projects like `ggerganov/whisper.cpp` and `xenova/transformers.js`.
- Use a dedicated Worker to avoid blocking the page main thread.

Tradeoffs:
- Pros: no cloud, low-latency, good accuracy for English; user data stays local.
- Cons: large downloads (tens to hundreds of MB), high CPU, mobile/low-power devices may struggle.

Integration steps (high-level):
1. Add a background or service worker that can spawn a shared Worker for Whisper processing (or use an extension-injected page-worker).
2. Provide an option in settings to download a chosen model on demand and store it in IndexedDB.
3. Capture audio from the video (see `capture_test.js`) and stream PCM frames to the worker for incremental transcription.
4. Merge STT output with subtitle text heuristics to improve detection confidence.

Notes:
- Start by prototyping with the smallest model (`tiny.en`) to validate integration and UX.
- Consider offering a cloud fallback when device cannot handle local inference.
