# Development guide

## How to load in Chrome

```bash
# 1. Open Chrome
# 2. Navigate to chrome://extensions
# 3. Toggle "Developer mode" ON (top-right)
# 4. Click "Load unpacked"
# 5. Select the project root: read-aloud-kokoro/
```

No build step, no package manager — plain HTML/CSS/JS.

## File map

```
manifest.json                  # Extension manifest (permissions, content scripts, popup)
content/content.js             # Main logic — injected into every page
content/content.css            # Highlight, control bar, selection button styles
popup/popup.html               # Toolbar popup HTML
popup/popup.js                 # Popup logic — settings, API health, messages
popup/popup.css                # Popup dark theme styles
lib/kokoro-api.js              # Reference API client (utility, not directly used)
icons/icon-*.png               # Extension icons (16, 48, 128 px)
```

## Key constants (content.js)

```
SENTENCE_REGEX = /[^.!?…\n]+[.!?…]+[\s\n]*|[^\n]+\n/g
BLOCK_TAGS     = Set('P','H1'..'H6','LI','TD','TH','DIV','ARTICLE','SECTION',...)
SKIP_TAGS      = Set('SCRIPT','STYLE','NOSCRIPT','SVG','MATH','CODE','TEXTAREA',...)
HEADING_TAGS   = Set('H1'..'H6')
```

Default settings (line 21):
```js
settings = { voice: 'af_heart', speed: 1.0, host: 'http://localhost:8880' }
```

## Message protocol

All messages flow through `chrome.tabs.sendMessage` (popup → content script) and `chrome.runtime.sendMessage` (content script → popup for state updates).

### Popup → Content script

| Message | Data | Response |
|---------|------|----------|
| `{ action: 'ping' }` | — | `{ ok, playing, paused, sentenceCount }` |
| `{ action: 'start' }` | — | `{ ok }` |
| `{ action: 'stop' }` | — | `{ ok }` |
| `{ action: 'toggle' }` | — | `{ ok, playing, paused }` |
| `{ action: 'pause' }` | — | `{ ok }` |
| `{ action: 'resume' }` | — | `{ ok }` |
| `{ action: 'setVoice', voice }` | voice: string | `{ ok }` |
| `{ action: 'setSpeed', speed }` | speed: number | `{ ok }` |
| `{ action: 'setHost', host }` | host: string | `{ ok }` |
| `{ action: 'getState' }` | — | `{ playing, paused, currentIndex, totalSentences, voice, speed, hasControlBar, hasSentences }` |
| `{ action: 'seekTo', index }` | index: number | `{ ok }` |

### Content script → Popup

| Message | Data |
|---------|------|
| `{ action: 'stateChanged', playing, paused }` | Sent on play, pause, stop, jump |

## chrome.storage.local keys

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `voice` | string | `'af_heart'` | Selected voice ID |
| `speed` | number | `1.0` | Playback speed multiplier |
| `kokoroHost` | string | `'http://localhost:8880'` | Kokoro API server URL |

## Error handling

- **Failed API call** (`synthesizeSentence` throws): logs error, increments currentIndex, skips to next sentence. If >10 consecutive failures, stops reading.
- **Audio playback error**: same skip-and-retry logic with 10-sentence limit.
- **Popup connection lost**: `sendToTab` catches "Could not establish connection" and returns `null` — popup gracefully handles this.
- **API unreachable**: popup shows red "offline" status with host address. All buttons remain usable but content script will fail gracefully on actual API calls.

## CSS class reference

| Class | Applied to | Purpose |
|-------|-----------|---------|
| `.ra-sentence` | `<span>` wrapping each sentence | Pointer cursor, hover effect |
| `.ra-sentence.ra-active` | Currently playing sentence | Yellow highlight + orange border |
| `.ra-temp-sentence` | Selection-only hidden spans | Same highlight but forced display |
| `#ra-control-bar` | `<div>` injected into page | Floating control panel at bottom |
| `#ra-selection-btn` | `<button>` | Appears after text selection |

## Common tasks for agents

### Adding a new voice

Edit the `DEFAULT_VOICES` fallback array in both:
- `content/content.js` `fetchVoices()` (line ~508)
- `popup/popup.js` `fetchVoices()` (line ~88)

### Changing the sentence regex

Edit `SENTENCE_REGEX` at the top of `content/content.js` (line 4). Tests needed: verify on pages with abbreviations, URLs with dots, ellipsis, mixed punctuation.

### Adding a new UI control to the floating bar

Edit `createControlBar()` in `content/content.js` (line ~437). The innerHTML template defines the HTML. Event listeners are attached immediately after.

### Adding a new popup setting

1. Add the input element to `popup/popup.html`
2. Add element reference in `popup.js` `els` object
3. Add event listener in `popup.js init()` block
4. Add chrome.storage key in `popup.js` and `content.js` storage.get calls
5. Add message handler case in `content.js` message listener
6. Persist the setting in `content.js` settings object
