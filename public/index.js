const loginBtn = document.getElementById('loginBtn');
const userBadge = document.getElementById('userBadge');
const form = document.getElementById('search-form');
const q = document.getElementById('q');
const results = document.getElementById('results');
const nowPlaying = document.getElementById('nowPlaying');
const playBtn = document.getElementById('play');
const pauseBtn = document.getElementById('pause');
const canvas = document.getElementById('viz');
const ctx = canvas.getContext('2d', { alpha: false });

function resizeCanvasForDPR() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
}
resizeCanvasForDPR();
addEventListener('resize', resizeCanvasForDPR);

// --- Login UI ---
loginBtn.addEventListener('click', () => {
  location.href = '/login';
});

async function fetchMe() {
  const r = await fetch('/api/me');
  if (r.status === 401) return null;
  const j = await r.json();
  return j;
}

// --- Web Playback SDK ---
let deviceId = null;
let player = null;
let beats = []; // seconds array
let trackId = null;

window.onSpotifyWebPlaybackSDKReady = async () => {
  player = new Spotify.Player({
    name: 'MusicViz Player',
    getOAuthToken: async cb => {
      const r = await fetch('/token');
      if (!r.ok) return;
      const { access_token } = await r.json();
      cb(access_token);
    },
    volume: 0.8
  });

  player.addListener('ready', ({ device_id }) => {
    deviceId = device_id;
    // Transfer playback to this device
    fetch('/api/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId })
    });
  });

  player.addListener('initialization_error', ({ message }) => console.error('init_err', message));
  player.addListener('authentication_error', ({ message }) => console.error('auth_err', message));
  player.addListener('account_error', ({ message }) => console.error('acct_err', message));
  player.addListener('playback_error', ({ message }) => console.error('playback_err', message));

  await player.connect();
};

// --- Search + Play ---
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
    return `
      <button class="track" data-uri="${t.uri}" data-id="${t.id}" title="${t.name} - ${artists}">
        <img src="${image}" alt="" />
        <div class="meta">
          <div class="t">${t.name}</div>
          <div class="a">${artists}</div>
        </div>
      </button>
    `;
  }).join('');
}

results.addEventListener('click', async (e) => {
  const btn = e.target.closest('.track');
  if (!btn) return;
  if (!deviceId) {
    alert('Player not ready. If you just logged in, wait a moment.');
    return;
  }
  const uri = btn.dataset.uri;
  trackId = btn.dataset.id;

  // Start playback
  await fetch('/api/play', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId, uri })
  });

  // Fetch beats for visualization
  beats = await getBeats(trackId);
  nowPlaying.textContent = 'Playing…';
});

playBtn.addEventListener('click', async () => {
  if (!player) return;
  await player.resume();
});
pauseBtn.addEventListener('click', async () => {
  if (!player) return;
  await player.pause();
});

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

// --- Beats (Audio Analysis) ---
async function getBeats(id) {
  try {
    const r = await fetch(`/api/analysis/${id}`);
    if (!r.ok) return [];
    const j = await r.json();
    return (j.beats || []).map(b => b.start); // seconds
  } catch {
    return [];
  }
}

// --- Visualization loop (pulse on nearest beat) ---
function draw() {
  const W = canvas.width;
  const H = canvas.height;
  ctx.fillStyle = '#0b0d10';
  ctx.fillRect(0, 0, W, H);

  if (player && beats.length) {
    player.getCurrentState().then(state => {
      if (!state) return;
      const posSec = state.position / 1000;
      // find time to next/prev beat
      let i = 0;
      while (i < beats.length && beats[i] < posSec) i++;
      const prev = beats[Math.max(0, i - 1)] ?? 0;
      const next = beats[i] ?? prev + 0.5;
      const dist = Math.min(Math.abs(posSec - prev), Math.abs(next - posSec));

      // Pulse strength inverse to distance to beat
      const strength = Math.max(0, 1 - dist * 4); // tweak falloff
      const bars = 48;
      const barWidth = (W / bars) * 0.8;
      const gap = (W / bars) * 0.2;

      for (let b = 0; b < bars; b++) {
        const v = Math.sin((b / bars) * Math.PI) * strength; // spatial shape
        const h = v * (H * 0.8) + 2;
        const x = b * (barWidth + gap);
        const y = H - h;
        ctx.fillStyle = `rgb(${Math.round(60 + v * 180)}, ${Math.round(160 + v * 80)}, 255)`;
        ctx.fillRect(x, y, barWidth, h);
      }
      ctx.fillStyle = '#111';
      ctx.fillRect(0, H - 2, W, 2);
    }).catch(() => {});
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

// --- Init: check login; seed results when logged in ---
(async () => {
  const me = await fetchMe();
  if (me) {
    userBadge.textContent = `Hi, ${me.display_name || me.id}`;
    loginBtn.style.display = 'none';
    try {
      const data = await searchTracks('Daft Punk');
      renderResults(data.tracks?.items || []);
    } catch {}
  } else {
    userBadge.textContent = 'Not logged in';
    loginBtn.style.display = 'inline-block';
  }
})();
