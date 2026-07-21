(function() {
  'use strict';

  function safeSend(msg) {
    try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch (_) {}
  }

  const SENTENCE_REGEX = /[^.!?…\n]+[.!?…]+[\s\n]*|[^\n]+\n/g;
  const BLOCK_TAGS = new Set([
    'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'LI', 'TD', 'TH', 'DIV', 'ARTICLE', 'SECTION',
    'BLOCKQUOTE', 'PRE', 'ASIDE', 'MAIN', 'DD', 'DT',
    'FIGCAPTION', 'LEGEND', 'SUMMARY', 'DETAILS',
  ]);
  const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

  let sentences = [];
  let currentIndex = -1;
  let isPlaying = false;
  let isPaused = false;
  let settings = { voice: 'af_heart', speed: 1.0, volume: 1.0, host: 'http://localhost:8880' };
  let audioEl = null;
  let controlBarEl = null;
  let selectionButtonEl = null;
  let totalSentences = 0;
  let pageTitle = null;

  let highlighter = {
    prevSpan: null,
    set(span) {
      if (this.prevSpan && this.prevSpan !== span) {
        this.prevSpan.classList.remove('ra-active');
      }
      if (span) {
        span.classList.add('ra-active');
        if (!span.classList.contains('ra-temp-sentence') &&
            !span.closest('#ra-fallback-content')) {
          span.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
      this.prevSpan = span;
    },
    clear() {
      if (this.prevSpan) {
        this.prevSpan.classList.remove('ra-active');
        this.prevSpan = null;
      }
    },
  };

  function findTextInDOM(root, searchText) {
    if (!searchText || searchText.length < 40) return null;
    const normalized = searchText.replace(/\s+/g, ' ').trim();
    // Try multiple prefix lengths for robustness
    for (const prefixLen of [150, 100, 60]) {
      const needle = normalized.substring(0, prefixLen);
      if (needle.length < 30) continue;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let best = null;
      let bestScore = 0;
      let node;
      while ((node = walker.nextNode())) {
        const t = node.textContent.replace(/\s+/g, ' ').trim();
        if (t.length < 40) continue;
        let score = 0;
        for (let i = 0; i < Math.min(needle.length, t.length); i++) {
          if (needle[i] === t[i]) score++; else break;
        }
        if (score > bestScore) { bestScore = score; best = node; }
      }
      if (best && bestScore > 25) {
        const candidates = [];
        const CLASS_RE = /post|article|content|entry|body|main|text|prose|parser/i;
        let el = best.parentElement;
        while (el && el !== root) {
          if (el.textContent.trim().length > 300 && (
            el.tagName === 'ARTICLE' || el.tagName === 'SECTION' ||
            el.tagName === 'DIV' || el.tagName === 'MAIN' ||
            CLASS_RE.test(el.className) || CLASS_RE.test(el.id)
          )) {
            candidates.push(el);
          }
          el = el.parentElement;
        }
        if (candidates.length > 0) return candidates[0];
        return best.parentElement;
      }
    }
    return null;
  }

  function getMainContentEl() {
    // 1. Try Mozilla Readability to locate main content in the original DOM
    try {
      const clone = document.cloneNode(true);
      const reader = new Readability(clone);
      const result = reader.parse();
      if (result && result.textContent && result.textContent.trim().length > 200) {
        pageTitle = result.title || null;
        const el = findTextInDOM(document.body, result.textContent);
        if (el) return el;
      }
    } catch (_) { /* fall through */ }

    // 2. Legacy: CSS selector-based detection
    // Only specific class/id selectors — no generic `main` or `#content` which break layout
    const selectors = [
      '.mw-parser-output',  // Wikipedia article body
      '#mw-content-text',   // Wikipedia content area
      '#bodyContent',       // Wikipedia fallback
      '.post-body', '.post-content', '.article-content', '.entry-content',
      '.markdown-body', '.prose',
      '[role="main"]',     // ARIA semantic role — safer than <main>
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 200) return el;
    }

    // Multiple article detection: pick the longest as main content;
    // if lengths are similar (feed), use the common ancestor
    const articles = document.querySelectorAll('article, [role="article"]');
    if (articles.length >= 2) {
      let best = null;
      let bestLen = 0;
      let totalLen = 0;
      for (const a of articles) {
        const len = a.textContent.trim().length;
        totalLen += len;
        if (len > bestLen) { bestLen = len; best = a; }
      }
      const avgLen = totalLen / articles.length;
      // If one article dominates (2x the average), it's the main content
      if (bestLen > avgLen * 2 && bestLen > 200) return best;

      // Otherwise find common ancestor (Facebook/news feed style)
      if (articles.length >= 3) {
        let ancestor = articles[0].parentNode;
        while (ancestor && ancestor !== document.documentElement) {
          let containsAll = true;
          for (const a of articles) {
            if (!ancestor.contains(a)) { containsAll = false; break; }
          }
          if (containsAll) return ancestor;
          ancestor = ancestor.parentNode;
        }
      }
    }

    // Last resort: off-screen clone — safe, no live DOM modification
    try {
      const clone = document.body.cloneNode(true);
      clone.querySelectorAll('script, style, noscript, nav, footer, header, aside, ' +
        '.sidebar, .nav, .menu, .comments, .advertisement, [role="navigation"], ' +
        '[role="banner"], [role="contentinfo"]')
        .forEach((e) => e.remove());
      if (clone.textContent.trim().length > 200) {
        clone.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
        clone.id = 'ra-fallback-content';
        document.body.appendChild(clone);
        return clone;
      }
    } catch (_) {}
    return null;
  }

  function wrapSelectionSentences(container) {
    sentences = [];
    let id = 0;

    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    const textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    for (const textNode of textNodes) {
      const text = textNode.textContent;
      const parent = textNode.parentNode;
      if (!parent) continue;

      let match;
      let lastIndex = 0;
      const parts = [];

      SENTENCE_REGEX.lastIndex = 0;
      while ((match = SENTENCE_REGEX.exec(text)) !== null) {
        if (match.index > lastIndex) {
          parts.push({ text: text.slice(lastIndex, match.index), sentence: false });
        }
        parts.push({ text: match[0], sentence: true });
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < text.length) {
        parts.push({ text: text.slice(lastIndex), sentence: false });
      }

      if (parts.filter((p) => p.sentence).length === 0) {
        if (text.trim().length > 1) {
          parts.length = 0;
          parts.push({ text: text, sentence: true });
        } else {
          continue;
        }
      }

      const fragment = document.createDocumentFragment();
      for (const part of parts) {
        if (part.text.trim().length > 1) {
          const span = document.createElement('span');
          span.className = 'ra-sentence';
          span.dataset.raId = String(id);
          span.textContent = part.text;
          fragment.appendChild(span);
          sentences.push({ id, text: part.text.trim(), element: span });
          id++;
        } else {
          if (fragment.childNodes.length > 0 && fragment.lastChild.nodeType === Node.TEXT_NODE) {
            fragment.lastChild.textContent += part.text;
          } else {
            fragment.appendChild(document.createTextNode(part.text));
          }
        }
      }

      parent.replaceChild(fragment, textNode);
    }

    mergeAdjacentSentences();
    totalSentences = sentences.length;
    return sentences;
  }

  function mergeAdjacentSentences() {
    // Merge spans that share the same block-level ancestor (p, li, h2, etc.)
    // and are consecutive — allowing traversal through inline elements (strong, em, a).
    const BLOCK_SET = new Set([...BLOCK_TAGS, ...HEADING_TAGS]);
    const toRemove = new Set();

    for (let i = 0; i < sentences.length - 1; i++) {
      if (toRemove.has(i)) continue;

      let j = i + 1;
      while (j < sentences.length && toRemove.has(j)) j++;
      if (j >= sentences.length) break;

      const current = sentences[i];
      const next = sentences[j];
      if (!current || !next || !current.element || !next.element) continue;
      if (!current.element.parentElement || !next.element.parentElement) continue;

      // Find the block-level ancestor for each span
      function blockAncestor(el) {
        let n = el.parentElement;
        while (n) { if (BLOCK_SET.has(n.tagName)) return n; n = n.parentElement; }
        return null;
      }
      const curBlock = blockAncestor(current.element);
      const nextBlock = blockAncestor(next.element);
      if (!curBlock || !nextBlock || curBlock !== nextBlock) continue;

      // Walk from current to next within the block; stop at non-whitespace content
      let node = current.element;
      let found = false;
      while (node && node !== next.element) {
        // Try next sibling, then walk up through inline parents
        while (!node.nextSibling && node.parentElement && node.parentElement !== curBlock) {
          node = node.parentElement;
        }
        if (!node.nextSibling) break;
        node = node.nextSibling;
        if (node === next.element) { found = true; break; }
        // Walk into inline elements to find text
        while (node.nodeType === Node.ELEMENT_NODE && !BLOCK_SET.has(node.tagName) && node.firstChild) {
          node = node.firstChild;
        }
        // Non-empty text or block element between spans → not consecutive
        if (node === next.element) { found = true; break; }
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) break;
        if (node.nodeType === Node.ELEMENT_NODE && node.textContent.trim() &&
            !node.classList.contains('ra-sentence')) break;
      }
      if (!found) continue;

      // Perform merge
      current.element.textContent =
        (current.element.textContent || '') + (next.element.textContent || '');
      current.text = current.element.textContent.trim();
      current.audioBuffer = null;
      if (next.audioBuffer) {
        current.audioBuffer = next.audioBuffer;
        next.audioBuffer = null;
      }

      next.element.remove();

      // If current span is inside an inline formatting element (strong, em, b, i, a),
      // move it out so the merged text doesn't become all-bold/all-italic
      const INLINE_TAGS = new Set(['STRONG', 'EM', 'B', 'I', 'A', 'CODE', 'MARK', 'SUB', 'SUP', 'U', 'S']);
      let wrap = current.element.parentElement;
      if (wrap && INLINE_TAGS.has(wrap.tagName) && wrap.parentElement) {
        wrap.parentElement.insertBefore(current.element, wrap.nextSibling);
        // Clean up empty wrapper if it has no remaining text
        if (!wrap.textContent.trim()) wrap.remove();
      }

      toRemove.add(j);
      i--;
    }

    if (toRemove.size === 0) return;

    sentences = sentences.filter((_, idx) => !toRemove.has(idx));
    for (let i = 0; i < sentences.length; i++) {
      sentences[i].id = i;
      sentences[i].element.dataset.raId = String(i);
    }
  }

  async function synthesizeSentence(text) {
    const res = await fetch(`${settings.host}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'kokoro',
        input: text,
        voice: settings.voice,
        speed: settings.speed,
        response_format: 'wav',
      }),
    });
    if (!res.ok) {
      throw new Error(`Kokoro API error (${res.status})`);
    }
    return res.arrayBuffer();
  }

  async function playSentence(index) {
    if (index < 0 || index >= sentences.length) {
      stopReading();
      return;
    }

    currentIndex = index;

    const s = sentences[index];
    if (!s) {
      stopReading();
      return;
    }

    highlighter.set(s.element);
    updateProgress();

    try {
      if (s.audioBuffer) {
        playAudioFromBuffer(s.audioBuffer, index);
      } else {
        const buffer = await synthesizeSentence(s.text);
        s.audioBuffer = buffer;
        playAudioFromBuffer(buffer, index);
      }
    } catch (err) {
      console.error('TTS error:', err);
      currentIndex++;
      if (currentIndex < sentences.length && currentIndex - index < 10) {
        playSentence(currentIndex);
      } else {
        stopReading();
      }
    }
  }

  function playAudioFromBuffer(buffer, index) {
    // Drop previous audio without revoking URL (avoid race condition —
    // the old audio's ended/error handler will clean up its own blob URL)
    if (audioEl) {
      audioEl.pause();
      audioEl.removeEventListener('ended', onAudioEnded);
      audioEl.onerror = null;
      audioEl = null;
    }

    const blob = new Blob([buffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    audioEl = new Audio(url);
    audioEl.playbackRate = settings.speed;
    audioEl.volume = settings.volume;
    audioEl._sentenceIndex = index;

    audioEl.addEventListener('ended', onAudioEnded);
    audioEl.addEventListener('error', () => {
      console.error('Audio error for sentence', index);
      URL.revokeObjectURL(url);
      currentIndex++;
      if (currentIndex < sentences.length && currentIndex - index < 10) {
        playSentence(currentIndex);
      } else {
        stopReading();
      }
    });

    audioEl.play().catch((err) => {
      console.error('Play error:', err.name, err.message);

      if (err.name === 'NotAllowedError') {
        // Autoplay blocked by browser — wait for next user click, then retry
        isPaused = true;
        isPlaying = false;
        updateControlBarPlayButton();
        const progressEl = document.getElementById('ra-progress');
        if (progressEl) progressEl.textContent = 'Click to start audio';

        const resumeOnClick = () => {
          document.removeEventListener('click', resumeOnClick, true);
          audioEl.play().then(() => {
            isPlaying = true;
            isPaused = false;
            updateControlBarPlayButton();
            updateProgress();
            prefetchNext(3);
          }).catch(() => {
            URL.revokeObjectURL(url);
            currentIndex++;
            if (currentIndex < sentences.length && currentIndex - index < 10) {
              playSentence(currentIndex);
            } else {
              stopReading();
            }
          });
        };
        document.addEventListener('click', resumeOnClick, { once: true, capture: true });
        return;
      }

      // Other errors: skip and retry
      URL.revokeObjectURL(url);
      currentIndex++;
      if (currentIndex < sentences.length && currentIndex - index < 10) {
        playSentence(currentIndex);
      } else {
        stopReading();
      }
    });
  }

  function onAudioEnded(e) {
    const idx = e.target._sentenceIndex;
    if (URL.revokeObjectURL) {
      URL.revokeObjectURL(e.target.src);
    }
    e.target.removeEventListener('ended', onAudioEnded);
    if (idx === currentIndex) {
      currentIndex++;
      playSentence(currentIndex);
    }
  }

  function prefetchNext(count = 3) {
    const start = Math.max(0, currentIndex + 1);
    const end = Math.min(sentences.length, start + count);
    for (let i = start; i < end; i++) {
      const s = sentences[i];
      if (s && !s.audioBuffer && !s._fetching) {
        s._fetching = true;
        synthesizeSentence(s.text)
          .then((buf) => {
            s.audioBuffer = buf;
            s._fetching = false;
          })
          .catch(() => {
            s._fetching = false;
          });
      }
    }
  }

  function updateProgress() {
    const progressEl = document.getElementById('ra-progress');
    if (progressEl) {
      progressEl.textContent = `${currentIndex + 1} / ${totalSentences}`;
    }
  }

  function stopReading(notify = true) {
    isPlaying = false;
    isPaused = false;
    if (audioEl) {
      audioEl.pause();
      audioEl.removeEventListener('ended', onAudioEnded);
      audioEl.onerror = null;
      audioEl = null;
    }
    highlighter.clear();
    currentIndex = -1;
    updateControlBarPlayButton();
    updateProgress();
    if (notify) {
      safeSend({ action: 'stateChanged', playing: false, paused: false });
    }
  }

  function pauseReading() {
    if (!isPlaying) return;
    isPaused = true;
    if (audioEl) {
      audioEl.pause();
    }
    updateControlBarPlayButton();
    safeSend({ action: 'stateChanged', playing: false, paused: true });
  }

  function resumeReading() {
    if (!isPaused || currentIndex < 0) return;
    isPaused = false;
    isPlaying = true;
    if (audioEl) {
      audioEl.play().catch((err) => {
        console.error('Resume error:', err.name, err.message);
        if (err.name === 'NotAllowedError') {
          isPaused = true;
          isPlaying = false;
          updateControlBarPlayButton();
          const progressEl = document.getElementById('ra-progress');
          if (progressEl) progressEl.textContent = 'Click to resume audio';
          document.addEventListener('click', () => {
            audioEl.play().then(() => {
              isPlaying = true;
              isPaused = false;
              updateControlBarPlayButton();
              updateProgress();
            }).catch(() => playSentence(currentIndex));
          }, { once: true, capture: true });
          return;
        }
        playSentence(currentIndex);
      });
    } else {
      playSentence(currentIndex);
    }
    updateControlBarPlayButton();
    safeSend({ action: 'stateChanged', playing: true, paused: false });
  }

  function jumpToSentence(index) {
    stopReading(false);
    isPlaying = true;
    isPaused = false;
    playSentence(index);
    updateControlBarPlayButton();
    safeSend({ action: 'stateChanged', playing: true, paused: false });
  }

  function handleSentenceClick(e) {
    const span = e.target.closest('.ra-sentence');
    if (!span) return;
    const id = parseInt(span.dataset.raId, 10);
    if (isNaN(id) || id < 0 || id >= sentences.length) return;
    jumpToSentence(id);
  }

  function createControlBar() {
    if (controlBarEl) return;

    controlBarEl = document.createElement('div');
    controlBarEl.id = 'ra-control-bar';
    controlBarEl.innerHTML = `
      <div class="ra-controls">
        <button id="ra-btn-play" title="Play / Pause">▶</button>
        <button id="ra-btn-stop" title="Stop">■</button>
        <button id="ra-btn-prev" title="Previous sentence">⏮</button>
        <button id="ra-btn-next" title="Next sentence">⏭</button>
        <span id="ra-progress">0 / 0</span>
        <select id="ra-voice-select"></select>
        <label class="ra-speed-label">Speed:
          <input type="range" id="ra-speed-slider" min="0.5" max="2.0" step="0.1" value="${settings.speed}">
          <span id="ra-speed-value">${settings.speed}x</span>
        </label>
        <label class="ra-volume-label">Vol:
          <input type="range" id="ra-volume-slider" min="0" max="100" step="5" value="${Math.round(settings.volume * 100)}">
        </label>
      </div>
    `;
    document.body.appendChild(controlBarEl);

    document.getElementById('ra-btn-play').addEventListener('click', togglePlayPause);
    document.getElementById('ra-btn-stop').addEventListener('click', () => {
      stopReading();
      removeSentences();
      closeControlBar();
    });
    document.getElementById('ra-btn-prev').addEventListener('click', () => {
      if (currentIndex > 0) jumpToSentence(currentIndex - 1);
    });
    document.getElementById('ra-btn-next').addEventListener('click', () => {
      if (currentIndex < sentences.length - 1) jumpToSentence(currentIndex + 1);
    });
    document.getElementById('ra-speed-slider').addEventListener('input', (e) => {
      settings.speed = parseFloat(e.target.value);
      document.getElementById('ra-speed-value').textContent = settings.speed + 'x';
      if (audioEl) {
        audioEl.playbackRate = settings.speed;
      }
      chrome.storage.local.set({ speed: settings.speed });
    });
    document.getElementById('ra-volume-slider').addEventListener('input', (e) => {
      settings.volume = parseInt(e.target.value, 10) / 100;
      if (audioEl) {
        audioEl.volume = settings.volume;
      }
      chrome.storage.local.set({ volume: settings.volume });
    });
    document.getElementById('ra-voice-select').addEventListener('change', (e) => {
      settings.voice = e.target.value;
      chrome.storage.local.set({ voice: settings.voice });
    });

    populateVoiceSelect();
    updateControlBarPlayButton();
    updateProgress();
  }

  function closeControlBar() {
    if (controlBarEl) {
      controlBarEl.remove();
      controlBarEl = null;
    }
  }

  async function populateVoiceSelect() {
    const select = document.getElementById('ra-voice-select');
    if (!select) return;

    const voices = await fetchVoices();
    select.innerHTML = '';
    for (const v of voices) {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = v.name;
      if (v.id === settings.voice) opt.selected = true;
      select.appendChild(opt);
    }
  }

  async function fetchVoices() {
    try {
      const res = await fetch(`${settings.host}/v1/audio/voices`);
      if (res.ok) {
        const data = await res.json();
        if (data.voices && data.voices.length > 0) {
          return data.voices.map((v) => ({
            id: typeof v === 'string' ? v : (v.id || v.name),
            name: typeof v === 'string' ? v : (v.name || v.id),
          }));
        }
      }
    } catch (_) {}
    return [
      { id: 'af_heart', name: 'Heart (Female, EN)' },
      { id: 'af_bella', name: 'Bella (Female, EN)' },
      { id: 'af_sarah', name: 'Sarah (Female, EN)' },
      { id: 'af_nicole', name: 'Nicole (Female, EN)' },
      { id: 'am_adam', name: 'Adam (Male, EN)' },
      { id: 'am_michael', name: 'Michael (Male, EN)' },
      { id: 'bf_emma', name: 'Emma (Female, UK)' },
      { id: 'bm_george', name: 'George (Male, UK)' },
      { id: 'hf_alpha', name: 'Alpha (Female, HU)' },
      { id: 'hf_beta', name: 'Beta (Female, HU)' },
      { id: 'hm_omega', name: 'Omega (Male, HU)' },
      { id: 'hm_psi', name: 'Psi (Male, HU)' },
    ];
  }

  function togglePlayPause() {
    if (isPaused) {
      resumeReading();
    } else if (isPlaying) {
      pauseReading();
    } else {
      startReading();
    }
  }

  function updateControlBarPlayButton() {
    const btn = document.getElementById('ra-btn-play');
    if (!btn) return;
    if (isPaused) {
      btn.textContent = '\u25b6';
      btn.title = 'Resume';
    } else if (isPlaying) {
      btn.textContent = '\u23f8';
      btn.title = 'Pause';
    } else {
      btn.textContent = '\u25b6';
      btn.title = 'Play';
    }
  }

  function prependTitle() {
    if (sentences.length === 0) return;

    // Get title from Readability result, or from page h1, or from document.title
    let title = pageTitle;
    if (!title) {
      const h1 = document.querySelector('h1');
      if (h1) title = h1.textContent.trim();
    }
    if (!title) title = document.title;
    if (!title) return;

    // Clean up common suffixes
    title = title.replace(/\s*[|–—\-–-]\s*.+$/, '').replace(/\s*[|–].*$/, '').trim();
    if (title.length < 3) return;

    // Check if title is already the beginning of the first sentence
    const firstText = sentences[0].text.replace(/\s+/g, ' ').trim();
    const titleStart = title.substring(0, Math.min(40, title.length)).replace(/\s+/g, ' ').trim();
    if (firstText.toLowerCase().includes(titleStart.toLowerCase())) return;

    // Create virtual sentence for the title (off-screen, audio only)
    const titleSpan = document.createElement('span');
    titleSpan.className = 'ra-sentence';
    titleSpan.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
    titleSpan.textContent = title + '. ';
    document.body.appendChild(titleSpan);

    sentences.unshift({ id: -1, text: title + '.', element: titleSpan, _title: true });

    totalSentences = sentences.length;
    for (let i = 0; i < sentences.length; i++) {
      sentences[i].id = i;
      sentences[i].element.dataset.raId = String(i);
    }
    if (currentIndex >= 0) currentIndex++;
  }

  function startReading() {
    if (sentences.length === 0) {
      stopReading();
      removeSentences();
      sentences = [];
      highlighter.clear();
      createControlBar();

      // Get the main content element and programmatically select it,
      // then use the SAME read-aloud path as manual selection.
      // This way highlighting, scrolling, and click-to-navigate all work.
      const main = getMainContentEl();
      if (!main || !main.textContent.trim()) {
        alert('No readable text found on this page.');
        return;
      }

      // Use the parent container so headings above the article body are included
      const range = document.createRange();
      range.selectNodeContents(main.parentElement || main);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);

      const text = selection.toString().trim();
      if (!text) {
        selection.removeAllRanges();
        alert('No readable text found on this page.');
        return;
      }

      // Use the exact same logic as manual selection read-aloud
      // (dirty detection → text-only or DOM wrapping → merge → play)
      readSelectedText(text);
      selection.removeAllRanges();
      return;
    }

    // Resume reading from current position (e.g. after pause)
    isPlaying = true;
    isPaused = false;
    const startIdx = currentIndex >= 0 ? currentIndex : 0;
    currentIndex = -1;
    playSentence(startIdx);
    prefetchNext(3);
    updateControlBarPlayButton();
    updateProgress();
    safeSend({ action: 'stateChanged', playing: true, paused: false });
  }

  function removeSentences() {
    for (const s of sentences) {
      if (s._temp && s.element) {
        // Temp spans (off-screen containers) — just remove
        s.element.remove();
      } else if (s.element && s.element.parentNode) {
        // Live page spans — restore original text node
        const parent = s.element.parentNode;
        const text = document.createTextNode(s.element.textContent);
        parent.replaceChild(text, s.element);
        parent.normalize();
      }
    }
    // Clean up off-screen containers
    for (const id of ['ra-page-container', 'ra-selection-container']) {
      const cont = document.getElementById(id);
      if (cont) cont.remove();
    }
    sentences = [];
    totalSentences = 0;
    currentIndex = -1;
    isPlaying = false;
    isPaused = false;
    audioEl = null;
  }

  function showSelectionButton(x, y) {
    hideSelectionButton();
    selectionButtonEl = document.createElement('button');
    selectionButtonEl.id = 'ra-selection-btn';
    selectionButtonEl.textContent = '🔊 Read aloud';
    selectionButtonEl.style.cssText = `
      position: fixed; z-index: 2147483647;
      left: ${x}px; top: ${y}px;
      background: #1a73e8; color: white; border: none;
      border-radius: 6px; padding: 6px 12px;
      font-size: 13px; cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    `;
    selectionButtonEl.addEventListener('click', () => {
      const sel = window.getSelection();
      if (sel && sel.toString().trim()) {
        readSelectedText(sel.toString().trim(), true);
      }
      hideSelectionButton();
    });
    document.body.appendChild(selectionButtonEl);
  }

  function hideSelectionButton() {
    if (selectionButtonEl) {
      selectionButtonEl.remove();
      selectionButtonEl = null;
    }
  }

  async function readSelectedText(text, skipTitle) {
    stopReading();
    removeSentences();
    sentences = [];
    highlighter.clear();
    createControlBar();

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);

    // Always use DOM wrapping — extract, wrap, reinsert
    const extractedFragment = range.extractContents();
    const tempContainer = document.createElement('div');
    tempContainer.appendChild(extractedFragment);
    wrapSelectionSentences(tempContainer);
    const wrappedFragment = document.createDocumentFragment();
    while (tempContainer.firstChild) {
      wrappedFragment.appendChild(tempContainer.firstChild);
    }
    range.insertNode(wrappedFragment);
    selection.removeAllRanges();

    if (sentences.length === 0) {
      alert('No readable text found in selection.');
      return;
    }

    // Prepend article title if not already the first sentence (page reads only)
    if (!skipTitle) prependTitle();

    totalSentences = sentences.length;
    isPlaying = true;
    isPaused = false;
    currentIndex = -1;
    playSentence(0);
    prefetchNext(3);
    updateControlBarPlayButton();
    updateProgress();
  }

  function onMouseUp(e) {
    setTimeout(() => {
      const sel = window.getSelection();
      if (sel && sel.toString().trim().length > 10) {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        showSelectionButton(
          rect.left,
          rect.bottom + 5
        );
      } else {
        hideSelectionButton();
      }
    }, 50);
  }

  document.addEventListener('click', handleSentenceClick, true);
  document.addEventListener('mouseup', onMouseUp, true);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.action) {
      case 'ping':
        sendResponse({ ok: true, playing: isPlaying, paused: isPaused, sentenceCount: sentences.length });
        break;

      case 'start': {
        createControlBar();
        startReading();
        sendResponse({ ok: true });
        break;
      }

      case 'stop': {
        stopReading();
        removeSentences();
        closeControlBar();
        sendResponse({ ok: true });
        break;
      }

      case 'toggle': {
        togglePlayPause();
        sendResponse({ ok: true, playing: isPlaying, paused: isPaused });
        break;
      }

      case 'pause': {
        pauseReading();
        sendResponse({ ok: true });
        break;
      }

      case 'resume': {
        resumeReading();
        sendResponse({ ok: true });
        break;
      }

      case 'setVoice': {
        settings.voice = msg.voice;
        chrome.storage.local.set({ voice: msg.voice });
        sendResponse({ ok: true });
        break;
      }

      case 'setSpeed': {
        settings.speed = msg.speed;
        if (audioEl) audioEl.playbackRate = msg.speed;
        chrome.storage.local.set({ speed: msg.speed });
        sendResponse({ ok: true });
        break;
      }

      case 'setVolume': {
        settings.volume = msg.volume;
        if (audioEl) audioEl.volume = msg.volume;
        chrome.storage.local.set({ volume: msg.volume });
        sendResponse({ ok: true });
        break;
      }

      case 'setHost': {
        settings.host = msg.host.replace(/\/+$/, '');
        chrome.storage.local.set({ kokoroHost: settings.host });
        sendResponse({ ok: true });
        break;
      }

      case 'getState': {
        sendResponse({
          playing: isPlaying,
          paused: isPaused,
          currentIndex,
          totalSentences,
          voice: settings.voice,
          speed: settings.speed,
          volume: settings.volume,
          hasControlBar: !!controlBarEl,
          hasSentences: sentences.length > 0,
        });
        break;
      }

      case 'seekTo': {
        if (msg.index >= 0 && msg.index < sentences.length) {
          jumpToSentence(msg.index);
        }
        sendResponse({ ok: true });
        break;
      }
    }
  });

  chrome.storage.local.get(['voice', 'speed', 'volume', 'kokoroHost'], (data) => {
    if (data.voice) settings.voice = data.voice;
    if (data.speed) settings.speed = data.speed;
    if (data.volume != null) settings.volume = data.volume;
    if (data.kokoroHost) settings.host = data.kokoroHost.replace(/\/+$/, '');
  });

  // Real-time sync: update control-bar sliders when popup changes speed/volume
  chrome.storage.onChanged.addListener((changes) => {
    const speedSlider = document.getElementById('ra-speed-slider');
    const speedValue = document.getElementById('ra-speed-value');
    const volumeSlider = document.getElementById('ra-volume-slider');
    if (changes.speed && speedSlider) {
      speedSlider.value = changes.speed.newValue;
      if (speedValue) speedValue.textContent = changes.speed.newValue + 'x';
      settings.speed = changes.speed.newValue;
    }
    if (changes.volume != null && volumeSlider) {
      volumeSlider.value = Math.round(changes.volume.newValue * 100);
      settings.volume = changes.volume.newValue;
    }
  });
})();
