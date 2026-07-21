const KOKORO_BASE = 'http://localhost:8880';

const DEFAULT_VOICES = [
  { id: 'af_heart', name: 'Heart (Female, EN)' },
  { id: 'af_bella', name: 'Bella (Female, EN)' },
  { id: 'af_sarah', name: 'Sarah (Female, EN)' },
  { id: 'af_nicole', name: 'Nicole (Female, EN)' },
  { id: 'af_sky', name: 'Sky (Female, EN)' },
  { id: 'am_adam', name: 'Adam (Male, EN)' },
  { id: 'am_michael', name: 'Michael (Male, EN)' },
  { id: 'hf_alpha', name: 'Alpha (Female, HU)' },
  { id: 'hf_beta', name: 'Beta (Female, HU)' },
  { id: 'hm_omega', name: 'Omega (Male, HU)' },
  { id: 'hm_psi', name: 'Psi (Male, HU)' },
];

async function fetchVoices() {
  try {
    const res = await fetch(`${KOKORO_BASE}/v1/audio/voices`);
    if (res.ok) {
      const data = await res.json();
      if (data.voices && data.voices.length > 0) {
        return data.voices.map((v) => ({ id: v.id || v, name: v.name || v.id || v }));
      }
    }
  } catch (_) {}
  return DEFAULT_VOICES;
}

async function synthesizeSpeech(text, { voice = 'af_heart', speed = 1.0, responseFormat = 'wav' } = {}) {
  const res = await fetch(`${KOKORO_BASE}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'kokoro',
      input: text,
      voice,
      speed,
      response_format: responseFormat,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Kokoro API error (${res.status}): ${errBody}`);
  }

  return res.arrayBuffer();
}

async function checkApiHealth() {
  try {
    const res = await fetch(`${KOKORO_BASE}/v1/models`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch (_) {
    return false;
  }
}
