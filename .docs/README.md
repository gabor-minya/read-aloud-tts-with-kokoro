# Read Aloud with Kokoro

**Chrome extension** — text-to-speech for web pages using a local [Kokoro TTS](https://github.com/remsky/Kokoro-FastAPI) API server.

## Features

- **Read full pages**: extracts readable content and reads sentence-by-sentence
- **Read selection**: highlight text on any page and click a floating button to play it
- **Sentence-level navigation**: click any sentence to jump playback to that position
- **Real-time highlight**: active sentence lights up yellow with orange border
- **Auto-scroll**: page scrolls smoothly to keep the spoken sentence centered
- **Floating control bar**: play/pause, stop, previous/next sentence, voice selector, speed slider (0.5x–2.0x)
- **Configurable API host**: input field in the popup to set the Kokoro server URL
- **Prefetch**: next 3 sentences are synthesized in the background for seamless playback
- **Adjacent sentence merging**: inline-formatted text (`<strong>`, `<em>`, `<b>`, etc.) is merged with surrounding text to avoid fragmented playback

## Requirements

- Chrome / Chromium-based browser (Manifest V3)
- A running Kokoro TTS API server (default: `http://localhost:8880`)

## API

The extension communicates with the Kokoro API at these endpoints:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/v1/audio/speech` | Synthesize speech from text |
| `GET` | `/v1/audio/voices` | List available voices |
| `GET` | `/v1/models` | Health check |

### Speech request

```json
POST /v1/audio/speech
{
  "model": "kokoro",
  "input": "Text to speak.",
  "voice": "af_heart",
  "speed": 1.0,
  "response_format": "wav"
}
```

Response: `audio/wav` binary.

## Installation (dev)

1. Go to `chrome://extensions`
2. Toggle **Developer mode** ON
3. Click **Load unpacked**
4. Select this project's root directory (`read-aloud-kokoro/`)
5. The extension icon appears in the toolbar

No build step required — plain JavaScript, HTML, CSS.
