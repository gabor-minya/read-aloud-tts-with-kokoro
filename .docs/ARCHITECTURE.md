# Architecture

## File structure

```
read-aloud-kokoro/
├── manifest.json              # Chrome MV3 manifest
├── content/
│   ├── content.js             # Core logic: text extraction, TTS, playback, highlight, scroll
│   └── content.css            # Sentence highlight + floating control bar styles
├── popup/
│   ├── popup.html             # Toolbar popup UI
│   ├── popup.js               # Popup logic: voice/speed/host config, API health, messaging
│   └── popup.css              # Dark-themed popup styles
├── lib/
│   └── kokoro-api.js          # Reference API client (not directly used, logic lives in content.js)
└── icons/
    ├── icon-16.png
    ├── icon-48.png
    └── icon-128.png
```

## Component responsibilities

### `content/content.js` (770 lines)

The main engine. Injected into every page via `content_scripts` in the manifest. Waits for user action (popup message or click on a wrapped sentence) before doing anything.

**Key functions:**

| Function | Lines | Purpose |
|----------|-------|---------|
| `getMainContentEl()` | 50–68 | Finds the main content element using selectors (article, main, .post-content, etc.) |
| `isInsideBlockElement()` | 80–88 | Checks if a text node is inside a block-level tag (P, DIV, LI, etc.) |
| `extractAndWrapSentences()` | 90–165 | Walks text nodes via TreeWalker, splits into sentences, wraps each in `<span class="ra-sentence" data-ra-id="N">` |
| `mergeAdjacentSentences()` | 178–231 | Post-processing: merges adjacent spans where the first lacks ending punctuation (handles `<strong>`, `<em>` fragments) |
| `synthesizeSentence()` | 233–248 | POSTs text to `/v1/audio/speech`, returns `ArrayBuffer` |
| `playSentence()` | 250–280 | Highlights, plays audio, handles errors with skip limit |
| `playAudioFromBuffer()` | 282–310 | Creates `Audio` element from buffer, attaches ended/error handlers |
| `onAudioEnded()` | 312–322 | Advances `currentIndex` and plays next sentence |
| `prefetchNext()` | 324–337 | Synthesizes next 3 sentences in background |
| `stopReading()` | 341–356 | Stops audio, clears highlight, resets state |
| `pauseReading()` / `resumeReading()` | 358–374 | Pause/resume with state notification to popup |
| `jumpToSentence()` | 376–382 | Stops current playback and starts at given index |
| `createControlBar()` | 437–486 | Injects floating `<div#ra-control-bar>` at bottom of page |
| `startReading()` | 537–555 | Entry point: extracts text, wraps sentences, begins playback |
| `removeSentences()` | 557–572 | Reverses wrapping: replaces spans with original text nodes |
| `readSelectedText()` | 594–621 | Handles selected-text playback with temporary hidden spans |
| `handleSentenceClick()` | 385–391 | Event delegation: click on `.ra-sentence` → jump to that sentence |
| `onMouseUp()` | 623–634 | Shows floating "Read aloud" button when >10 chars selected |

**Message handlers** (line ~678):
- `ping` — health check from popup
- `start` — begin reading page
- `stop` — stop and unwrap
- `toggle` — play/pause
- `pause` / `resume` — pause/resume
- `setVoice` / `setSpeed` / `setHost` — update settings
- `getState` — return current state to popup
- `seekTo` — jump to sentence index

### `popup/popup.js` (271 lines)

Runs in the extension toolbar popup. Communicates with content script via `chrome.tabs.sendMessage`.

**Key functions:**

| Function | Purpose |
|----------|---------|
| `init()` | Loads settings from storage, checks API health via `/v1/models`, loads voice list, syncs state with content script |
| `sendToTab()` | Wraps `chrome.tabs.sendMessage` with error handling for disconnected content script |
| `checkApiHealth()` | GETs `/v1/models` with 3s timeout |
| `fetchVoices()` | GETs `/v1/audio/voices`, falls back to hardcoded list |
| `refreshState()` | Queries content script for current playback state |
| `updatePlayButton()` | Switches button text between "Read page", "Pause", "Resume" |
| `normalizeHost()` | Strips trailing `/`, adds `http://` prefix if missing |

### `popup/popup.html`

Contains:
- **Host input** (`#host-input`): text field for Kokoro API URL
- **Status indicator** (`#status-indicator`): online/offline/checking states
- **Voice selector** (`#voice-select`): dropdown populated from API
- **Speed slider** (`#speed-slider`): 0.5x–2.0x range
- **Action buttons**: Read page, Stop, Pause
- **Info bar**: sentence progress and status text

## Data flow

```
User clicks "Read page" (popup)
    │
    ▼
popup.js → chrome.tabs.sendMessage({ action: 'start' })
    │
    ▼
content.js message listener
    │
    ├─► createControlBar()         — injects floating bar into page DOM
    ├─► getMainContentEl()         — finds content element
    ├─► extractAndWrapSentences()  — walks DOM, wraps sentences in spans
    │
    ▼
startReading()
    │
    ├─► playSentence(0)            — highlight sentence 0
    │     └─► synthesizeSentence() — POST to /v1/audio/speech
    │           └─► playAudioFromBuffer() — create Audio element, .play()
    │
    ├─► onAudioEnded()             — auto-advances to next sentence
    │     └─► playSentence(N+1)
    │
    └─► prefetchNext(3)            — background TTS for sentences 1–3
```

## Sentence wrapping & merging

### TreeWalker extraction

```js
const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
  acceptNode(node) {
    if (!node.textContent.trim()) return FILTER_REJECT;
    if (!isInsideBlockElement(node)) return FILTER_REJECT;
    return FILTER_ACCEPT; // accept ALL text nodes inside block elements
  }
});
```

- All non-empty text nodes inside block-level tags (P, H1–H6, LI, TD, DIV, etc.) are collected
- Each text node is split by sentence regex: `/[^.!?…\n]+[.!?…]+[\s\n]*|[^\n]+\n/g`
- Text fragments without punctuation (e.g., headings, inline `<strong>`) are still accepted and become their own sentence initially

### Adjacent merge

After wrapping, `mergeAdjacentSentences()` walks the sentences array:

1. If sentence N does **not** end with `.!?…`
2. AND sentence N+1 is immediately adjacent in the DOM (no non-ra-sentence content between them)
3. → Merge N and N+1 into a single span, remove N+1, reindex

This handles cases like:

```html
<li><strong>Desktop flows</strong> extend automation to tasks...</li>
```

Before merge: `["Desktop flows", "extend automation to tasks..."]`  
After merge: `["Desktop flows extend automation to tasks..."]`

## State management

**Content script** holds the canonical state:
- `sentences[]` — array of `{ id, text, element, audioBuffer? }`
- `currentIndex` — which sentence is playing
- `isPlaying` / `isPaused` — playback state
- `settings` — `{ voice, speed, host }`

**Popup** syncs by calling `getState` on open and after each action. Content script sends `stateChanged` messages on play/pause/stop/jump for real-time updates.

**chrome.storage.local** persists:
- `voice` — selected voice ID
- `speed` — playback speed (0.5–2.0)
- `kokoroHost` — API server URL
