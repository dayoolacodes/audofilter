# CleanMute

CleanMute is a small Chrome extension (Manifest V3) that detects profanity in visible subtitles/captions on Netflix and Amazon Prime Video and temporarily mutes the video/tab and optionally censors the subtitle text.

Features
- Detects subtitles via MutationObserver and by scanning likely subtitle containers.
- Configurable blocked words list stored in `chrome.storage.sync`.
- Temporarily mutes the largest visible playing video element when a blocked word appears.
- Configurable mute duration (default 1500ms) and optional subtitle censoring.
- Popup UI to enable/disable filtering, edit blocked words, set duration, and toggle censoring.
- Demo/test mode available via the popup.

Files
- [manifest.json](manifest.json)
- [content.js](content.js)
- [popup.html](popup.html)
- [popup.js](popup.js)
- [popup.css](popup.css)
- [background.js](background.js)

Installation (Load unpacked)
1. Open Chrome and go to the extensions page:

```bash
open 'chrome://extensions'
```

2. Enable *Developer mode* (toggle top-right).
3. Click *Load unpacked* and select this folder:

```
/Users/dayoola/Dev/audofilter
```

4. The extension will load. Click the toolbar icon to open the popup and adjust settings.

Packaging (optional)
You can create a ZIP of the extension folder to distribute or keep as an archive:

```bash
cd /Users/dayoola/Dev/audofilter
zip -r cleanmute.zip . -x '*.git*' '*.DS_Store'
```


Usage / Testing
- Open a supported site: `netflix.com`, `primevideo.com`, or `amazon.com/gp/video/*`.
- Use the popup to set blocked words (one per line), mute duration in milliseconds, and enable/disable censoring.
- Press *Inject Demo* in the popup on any page to create a demo subtitle div and test behavior.

Developer notes
- The content script uses a MutationObserver to monitor DOM changes and a periodic scan as a backup.
- It chooses the largest visible video element (preferring playing videos) to mute and restores the previous mute state after the configured duration.
- Debouncing prevents repeated triggers for the same blocked word in a short interval.
- The extension does not modify video streams or bypass DRM; it only toggles the `muted` property and temporarily edits DOM subtitle text.
- If you need icons, add them under an `icons/` folder and update `manifest.json` accordingly.

Troubleshooting
- If the popup shows settings but the content script doesn't seem active, ensure the page matches the content script `matches` in [manifest.json](manifest.json) and try *Reload* on the extensions page, or press *Inject Demo* to programmatically inject the content script via the popup.

Security & privacy
- No external libraries are used. The extension only stores user settings in `chrome.storage.sync` and does not transmit video or audio data anywhere.

License
- MIT-style (add your preferred license if needed).
