#!/bin/bash
# Fetch YouTube captions for the demo video
# Usage: ./fetch-captions.sh [VIDEO_ID]
# Requires: yt-dlp (brew install yt-dlp)

VIDEO_ID="${1:-rzuTQZqGp8w}"
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Fetching captions for: $VIDEO_ID"
yt-dlp \
  --write-auto-sub \
  --write-sub \
  --sub-lang en \
  --sub-format vtt \
  --skip-download \
  -o "$DIR/demo-video" \
  "https://www.youtube.com/watch?v=$VIDEO_ID"

# yt-dlp saves as demo-video.en.vtt
if [ -f "$DIR/demo-video.en.vtt" ]; then
  echo "Saved to $DIR/demo-video.en.vtt"
  echo "Cue count: $(grep -c '\-\->' "$DIR/demo-video.en.vtt")"
else
  echo "Failed — YouTube may be rate-limiting. Try again in a few minutes."
  exit 1
fi
