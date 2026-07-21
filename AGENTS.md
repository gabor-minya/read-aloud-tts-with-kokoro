# Read Aloud TTS with Kokoro – Chrome TTS Extension

Chrome Manifest V3 extension that reads web pages aloud sentence-by-sentence using a local [Kokoro TTS](https://github.com/remsky/Kokoro-FastAPI) API server.

## Project

- **Stack:** Plain HTML/CSS/JS – no build step, no package manager, no modules.
- **Entry point:** `extension/manifest.json` → content script (`extension/content/content.js`) injected into every page; popup (`extension/popup/popup.html` + `extension/popup/popup.js`) for settings.
- **API server:** Kokoro TTS at `http://localhost:8880` (default; configurable in popup). Endpoints: `POST /v1/audio/speech`, `GET /v1/audio/voices`, `GET /v1/models`.
- **Docs:** `.docs/ARCHITECTURE.md` (full component map, data flow, sentence-wrapping logic), `.docs/DEVELOPMENT.md` (message protocol, storage keys, common tasks).

## Commands

No build, no tests, no lint step. Load manually:
```bash
# chrome://extensions → Developer mode ON → Load unpacked → select project root
```

## Architecture

```
extension/content/content.js   — Core engine: DOM TreeWalker extraction, sentence regex
                             split, <span class="ra-sentence"> wrapping, adjacent
                             merge, TTS synthesis, Audio playback, highlight, auto-scroll,
                             floating #ra-control-bar, selection read-aloud, message listener
extension/popup/popup.js     — Toolbar popup: host/voice/speed config, API health check,
                             chrome.tabs.sendMessage bridge, state sync
extension/popup/popup.html   — Popup DOM: host input, voice select, speed slider, action buttons
extension/popup/popup.css    — Dark theme (320px wide), CSS variables
extension/content/content.css — Sentence highlight (.ra-sentence, .ra-active), control bar,
                             selection button styles
extension/lib/readability.js — Mozilla Readability (content extraction engine)
extension/manifest.json      — MV3: activeTab + storage permissions
extension/icons/             — Extension icons (16, 48, 128 px)
```

Key constants in `content.js`:
- `SENTENCE_REGEX = /[^.!?…\n]+[.!?…]+[\s\n]*|[^\n]+\n/g`
- `BLOCK_TAGS`, `SKIP_TAGS`, `HEADING_TAGS` (Set)
- Default settings: `{ voice: 'af_heart', speed: 1.0, host: 'http://localhost:8880' }`

## Conventions

- **IIFE** wrapping: `(function() { 'use strict'; … })()` in both content.js and popup.js.
- **CSS prefix:** `ra-` for all injected classes/IDs (`.ra-sentence`, `#ra-control-bar`).
- **IPC:** Popup → content via `chrome.tabs.sendMessage`; content → popup via `chrome.runtime.sendMessage({ action: 'stateChanged', … })`. Full message protocol in `.docs/DEVELOPMENT.md`.
- **Storage:** `chrome.storage.local` keys: `voice`, `speed`, `kokoroHost`.
- **Error handling:** Skip-and-retry up to 10 consecutive failures, then stop. Audio errors caught via `addEventListener('error', …)` + `play().catch(…)`.
- **Voice lists:** Duplicated `DEFAULT_VOICES` fallback in both `content.js fetchVoices()` and `popup.js fetchVoices()` — keep them in sync when adding voices.
- **No type checking, no linting** configured — keep code compatible with raw Chrome extension loading.

## Notes

