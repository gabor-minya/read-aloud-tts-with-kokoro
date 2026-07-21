# Read Aloud TTS with Kokoro

A Chrome extension that converts web pages to speech using a locally running [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) text-to-speech server. Reads articles aloud sentence-by-sentence with real-time highlighting and playback controls — no data ever leaves your device.

## Features

- **Read full pages** — auto-detects main content on any article page using Mozilla Readability
- **Read selection** — highlight any text and click the floating "Read aloud" button to play it
- **Sentence-level navigation** — click any highlighted sentence to jump playback to that position
- **Real-time highlighting** — active sentence lights up in yellow as it plays
- **Floating control bar** — play/pause, stop, previous/next, voice selector, speed slider (0.5–2.0×)
- **Multi-voice support** — all Kokoro voices: English, Hungarian, UK English, and more
- **Smart prefetch** — next 3 sentences are synthesized in the background for seamless playback
- **Privacy-first** — all TTS processing happens on your local machine via the Kokoro-FastAPI server

## Requirements

- [Docker](https://docs.docker.com/get-docker/) installed on your machine
- A running [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) server at `http://localhost:8880`

## Quick Start

### 1. Start the Kokoro TTS server

```bash
# CPU (works on any machine):
docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest

# NVIDIA GPU:
docker run --gpus all -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-gpu:latest
```

The first run downloads the model (~1 GB). Wait for the `FastKoko` ASCII art banner — then the server is ready.

### 2. Install the extension

- Go to `chrome://extensions`
- Toggle **Developer mode** ON
- Click **Load unpacked**
- Select the `extension/` folder from this project

### 3. Start reading!

Click the extension icon in your toolbar, then press **Read page**.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Host | `http://localhost:8880` | Kokoro API server URL |
| Voice | `af_heart` | TTS voice (English: af_heart, af_bella, am_adam; UK: bf_emma, bm_george; Hungarian: hf_alpha, hm_omega) |
| Speed | `1.0` | Playback speed (0.5–2.0) |

## Privacy

**No data collection.** This extension does not collect, store, or transmit any personal data. All settings (voice, speed, host) are stored locally on your device using Chrome's local storage API. The extension communicates exclusively with your local Kokoro TTS server at `localhost:8880`. No external servers are contacted. No analytics. No tracking.

## License

MIT — see [LICENSE](LICENSE).

`lib/readability.js` is [Mozilla Readability](https://github.com/mozilla/readability) (Apache 2.0, copyright Arc90 Inc).
