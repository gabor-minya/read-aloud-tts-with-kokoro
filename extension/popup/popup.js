(async function() {
  'use strict';

  const DEFAULT_HOST = 'http://localhost:8880';

  let currentTabId = null;
  let isPlaying = false;
  let isPaused = false;
  let voice = 'af_heart';
  let speed = 1.0;
  let kokoroBase = DEFAULT_HOST;

  const els = {
    statusIndicator: document.getElementById('status-indicator'),
    statusText: document.getElementById('status-text'),
    hostInput: document.getElementById('host-input'),
    voiceSelect: document.getElementById('voice-select'),
    speedSlider: document.getElementById('speed-slider'),
    speedDisplay: document.getElementById('speed-display'),
    btnStart: document.getElementById('btn-start'),
    btnStop: document.getElementById('btn-stop'),
    info: document.getElementById('info'),
    infoProgress: document.getElementById('info-progress'),
    infoStatus: document.getElementById('info-status'),
  };

  function normalizeHost(raw) {
    if (!raw) return DEFAULT_HOST;
    let h = raw.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(h)) {
      h = 'http://' + h;
    }
    return h;
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  function isRestrictedUrl(url) {
    return !url || url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:');
  }

  async function sendToTab(action, data = {}) {
    if (!currentTabId) return null;
    try {
      return await chrome.tabs.sendMessage(currentTabId, { action, ...data });
    } catch (err) {
      if (err.message.includes('Could not establish connection') || err.message.includes('receiving end does not exist')) {
        return null;
      }
      throw err;
    }
  }

  async function checkApiHealth() {
    try {
      const res = await fetch(`${kokoroBase}/v1/models`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch (_) {
      return false;
    }
  }

  async function fetchVoices() {
    try {
      const res = await fetch(`${kokoroBase}/v1/audio/voices`);
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

  function updatePlayButton() {
    if (isPaused) {
      els.btnStart.textContent = '\u25b6 Resume';
      els.btnStart.className = 'btn primary';
    } else if (isPlaying) {
      els.btnStart.textContent = '\u23f8 Pause';
      els.btnStart.className = 'btn secondary';
    } else {
      els.btnStart.textContent = '\u25b6 Read page';
      els.btnStart.className = 'btn primary';
    }
  }

  function updateUI() {
    updatePlayButton();
    els.btnStop.disabled = !isPlaying && !isPaused;

    if (isPlaying && !isPaused) {
      els.infoStatus.textContent = 'Reading...';
    } else if (isPaused) {
      els.infoStatus.textContent = 'Paused';
    } else {
      els.infoStatus.textContent = 'Ready';
    }
  }

  async function refreshState() {
    const state = await sendToTab('getState');
    if (state) {
      isPlaying = state.playing;
      isPaused = state.paused;
      if (state.hasControlBar) {
        els.info.style.display = 'flex';
        els.infoProgress.textContent = `${state.currentIndex + 1} / ${state.totalSentences}`;
      }
      if (state.voice) voice = state.voice;
      if (state.speed) {
        speed = state.speed;
        els.speedSlider.value = speed;
        els.speedDisplay.textContent = speed + 'x';
      }
    }
    updateUI();
  }

  async function init() {
    const tab = await getActiveTab();
    currentTabId = tab?.id;

    if (!tab || isRestrictedUrl(tab.url)) {
      els.statusText.textContent = 'Page not supported';
      els.statusIndicator.className = 'status offline';
      els.btnStart.disabled = true;
      return;
    }

    const stored = await chrome.storage.local.get(['voice', 'speed', 'kokoroHost']);
    if (stored.voice) voice = stored.voice;
    if (stored.speed) {
      speed = stored.speed;
      els.speedSlider.value = speed;
      els.speedDisplay.textContent = speed + 'x';
    }
    if (stored.kokoroHost) {
      kokoroBase = normalizeHost(stored.kokoroHost);
      els.hostInput.value = kokoroBase;
    } else {
      els.hostInput.value = DEFAULT_HOST;
    }

    await refreshStatus();

    const voices = await fetchVoices();
    els.voiceSelect.innerHTML = '';
    for (const v of voices) {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = v.name;
      if (v.id === voice) opt.selected = true;
      els.voiceSelect.appendChild(opt);
    }

    await refreshState();
  }

  async function refreshStatus() {
    els.statusIndicator.className = 'status checking';
    els.statusText.textContent = 'Checking API...';

    const healthy = await checkApiHealth();
    const displayHost = kokoroBase.replace(/^https?:\/\//, '');
    if (healthy) {
      els.statusIndicator.className = 'status online';
      els.statusText.textContent = `API reachable (${displayHost})`;
    } else {
      els.statusIndicator.className = 'status offline';
      els.statusText.textContent = `API unreachable! Check if server is running at ${displayHost}.`;
    }
  }

  els.hostInput.addEventListener('change', async () => {
    kokoroBase = normalizeHost(els.hostInput.value);
    els.hostInput.value = kokoroBase;
    await chrome.storage.local.set({ kokoroHost: kokoroBase });
    await sendToTab('setHost', { host: kokoroBase });
    await refreshStatus();
  });

  els.voiceSelect.addEventListener('change', async () => {
    voice = els.voiceSelect.value;
    await chrome.storage.local.set({ voice });
    await sendToTab('setVoice', { voice });
  });

  els.speedSlider.addEventListener('input', async () => {
    speed = parseFloat(els.speedSlider.value);
    els.speedDisplay.textContent = speed.toFixed(1) + 'x';
  });

  els.speedSlider.addEventListener('change', async () => {
    speed = parseFloat(els.speedSlider.value);
    els.speedDisplay.textContent = speed.toFixed(1) + 'x';
    await chrome.storage.local.set({ speed });
    await sendToTab('setSpeed', { speed });
  });

  els.btnStart.addEventListener('click', async () => {
    if (!currentTabId) return;

    if (isPlaying || isPaused) {
      const resp = await sendToTab('toggle');
      if (resp) {
        isPlaying = resp.playing;
        isPaused = resp.paused;
        updateUI();
      }
    } else {
      const resp = await sendToTab('start');
      if (resp?.ok) {
        isPlaying = true;
        isPaused = false;
        els.info.style.display = 'flex';
        updateUI();
      }
    }

    await refreshState();
  });

  els.btnStop.addEventListener('click', async () => {
    await sendToTab('stop');
    isPlaying = false;
    isPaused = false;
    els.info.style.display = 'none';
    updateUI();
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'stateChanged') {
      isPlaying = msg.playing;
      isPaused = msg.paused;
      updateUI();
    }
  });

  init();
})();
