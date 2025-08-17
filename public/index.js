// Minimal, resilient visualizer using Web Audio API and Spotify preview URLs

const form = document.getElementById('search-form');
const q = document.getElementById('q');
const results = document.getElementById('results');
const audio = document.getElementById('audio');
const nowPlaying = document.getElementById('nowPlaying');
const playBtn = document.getElementById('play');
const pauseBtn = document.getElementById('pause');
const volume = document.getElementById('volume');
const canvas = document.getElementById('viz');
const ctx = canvas.getContext('2d', { alpha: false });

// CSS/Canvas crispness fix on HiDPI
function resizeCanvasForDPR() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
}
resizeCanvasForDPR();
addEventListener('resize', resizeCanvasForDPR);

// Lock AudioContext until user gesture
let audioCtx;
let analyser;
let srcNode;
let dataArray;

function ensureAudioChain() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const track = audioCtx.createMediaElementSource(audio);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;               // decent resolution without getting too heavy
  analyser.smoothingTimeConstant = 0.85; // smoother bars
  track.connect(analyser);
  analyser.connect(audioCtx.destination);
  dataArray = new Uint8Array(analyser.frequencyBinCount);
}

async function searchTracks(query) {
  const url = new URL('/api/search', location.origin);
  url.searchParams.set('q', query);
  const r = await fetch(url);
  if (!r.ok) throw new Error('Search failed');
  return r.json();
}

function renderResults(items = []) {
  if (!items.length) {
    results.innerHTML = `<div class="empty">No results. Try a different query.</div>`;
    return;
  }
  results.innerHTML = items.map(t => {
    const artists = (t.artists || []).map(a => a.name).join(', ');
    const image = t.album?.images?.[1]?.url || t.album?.images?.[0]?.url || '';
    const disabled = !t.preview_url ? 'disabled' : '';
    return `
      <button class="track" data-id="${t.id}" ${disabled} title="${t.name} - ${artists}">
        <img src="${image}" alt="" />
        <div class="meta">
          <div class="t">${t.name}</div>
          <div class="a">${artists}</div>
          ${t.preview_url ? '' : '<div class="no-prev">No preview</div>'}
        </div>
      </button>
    `;
  }).join('');
}

async function loadTrack(id) {
  const r = await fetch(`/api/track/${id}`);
  if (!r.ok) throw new Error('Track fetch failed');
  const t = await r.json();
  if (!t.preview_url) {
    nowPlaying.textContent = 'No preview available for this track.';
    return;
  }
  audio.src = t.preview_url;
  nowPlaying.textContent = `${t.name} — ${(t.artists || []).map(a => a.name).join(', ')}`;
  await audio.play().catch(() => {}); // autoplay policies may block; user can press Play
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = q.value.trim();
  if (!query) return;
  try {
    const data = await searchTracks(query);
    renderResults(data.tracks?.items || []);
  } catch (err) {
    console.error(err);
    results.innerHTML = `<div class="error">Search failed.</div>`;
  }
});

results.addEventListener('click', async (e) => {
  const btn = e.target.closest('.track');
  if (!btn || btn.disabled) return;
  ensureAudioChain();
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  await loadTrack(btn.dataset.id);
});

playBtn.addEventListener('click', async () => {
  ensureAudioChain();
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  await audio.play();
});
pauseBtn.addEventListener('click', () => audio.pause());
volume.addEventListener('input', () => { audio.volume = Number(volume.value); });

// --- Visualization loop ---
function draw() {
  if (analyser) {
    analyser.getByteFrequencyData(dataArray);
    const W = canvas.width;
    const H = canvas.height;

    // Clear (opaque bg to avoid CSS paint issues)
    ctx.fillStyle = '#0b0d10';
    ctx.fillRect(0, 0, W, H);

    // Bars
    const bars = 96; // choose subset to avoid too many thin bars
    const step = Math.floor(dataArray.length / bars);
    const barWidth = (W / bars) * 0.8;
    const gap = (W / bars) * 0.2;

    for (let i = 0; i < bars; i++) {
      const v = dataArray[i * step] / 255;
      const h = v * (H * 0.9) + 1;
      const x = i * (barWidth + gap);
      const y = H - h;

      // gradient-ish luminance without picking CSS colors explicitly
      ctx.fillStyle = `rgb(${Math.round(40 + v * 180)}, ${Math.round(200 - v * 120)}, ${Math.round(255)})`;
      ctx.fillRect(x, y, barWidth, h);
    }

    // baseline
    ctx.fillStyle = '#111';
    ctx.fillRect(0, H - 2, W, 2);
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

// Start with a friendly default search to reduce “empty page” feel
(async () => {
  try {
    const data = await searchTracks('Daft Punk');
    renderResults(data.tracks?.items || []);
  } catch {}
})();
// index.js placeholder. Use full code provided in the conversation.
