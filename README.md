# CleanMute

Chrome extension that automatically mutes audio when profanity appears in video subtitles. Works on any website — YouTube, Netflix, Prime Video, and more.

## Features

- **Subtitle file interception** — Catches TTML/WebVTT subtitle downloads for precise, pre-scheduled muting with exact timing
- **DOM fallback** — Scans on-screen subtitle elements when file interception isn't available
- **Tab-level muting** — Mutes the browser tab (not the video element), avoiding DRM detection issues
- **Customizable word list** — Add or remove blocked words via the popup
- **Works everywhere** — Runs on any site with video subtitles
- **No data collection** — Everything runs locally, no servers or external services

## Installation

### Chrome Web Store
*(Coming soon)*

### Load unpacked (developer)
1. Go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select this folder
4. Click the toolbar icon to open settings

## Usage

1. Play a video with subtitles/captions enabled
2. The extension automatically detects blocked words and mutes the tab audio
3. Open the popup to customize blocked words, mute duration, and pre-mute lead time
4. Status indicator shows which detection mode is active:
   - **Subtitle file (precise)** — intercepted subtitle download with exact timing
   - **DOM scan (fallback)** — reading on-screen subtitle text

## How It Works

1. **Intercepts subtitle file downloads** (fetch/XHR) to get full transcript with millisecond timing
2. **Estimates word position** within each subtitle line to calculate when the blocked word is spoken
3. **Pre-schedules mutes** based on `video.currentTime`, muting the tab at the right moment
4. **Falls back to DOM scanning** if subtitle files can't be intercepted

## Privacy

No data is collected or transmitted. See [PRIVACY.md](PRIVACY.md) for details.

## License

MIT
