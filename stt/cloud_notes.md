# Cloud STT Notes

Quick overview of cloud STT integration options and privacy considerations.

Providers:
- Google Cloud Speech-to-Text — strong accuracy, supports long-form, costs apply.
- Microsoft Azure Speech Services — good accuracy, customization options.
- OpenAI Whisper API — high quality, simple API.

Integration pattern:
1. Capture short audio snippets (e.g., 1–5s) from the video stream using `MediaRecorder` (see `capture_test.js`).
2. Convert to the required format (e.g., WAV, FLAC) and send to the cloud API.
3. Receive transcript and feed into CleanMute detection pipeline.

Privacy & UX:
- Must explicitly request user consent and provide clear opt-in toggles.
- Avoid continuous streaming unless user accepts possible data transfer costs.
- Consider automatic batching and rate limits to reduce API usage.

Security:
- Never hardcode API keys in the extension; use an external server or prompt the user to provide their own API key.
