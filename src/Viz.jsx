// public/index.js
import '../scr/styles.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import Visualizer from '../src/Viz.jsx';

// --- Grab DOM once the document is ready ---
function qs(id, name) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`${name || id} not found`);
  return el;
}

const loginBtn   = qs('loginBtn', 'Login button');
const rootEl     = qs('root', 'Root element');
const userBadge  = qs('userBadge', 'User badge');
const searchForm = qs('search-form', 'Search form');
const q          = qs('q', 'Search input');
const results    = qs('results', 'Results container');
const nowPlaying = qs('nowPlaying', 'Now playing element');
const playBtn    = qs('play', 'Play button');
const pauseBtn   = qs('pause', 'Pause button');

// --- React root ---
const root = createRoot(rootEl);

// We’ll re-render when player or beats change:
let player = null;
let beats = [];      // array of beat times (seconds)
let deviceId = null; // Spotify device id
let trackId = null;

function renderApp() {
  root.render(<Visualizer player={player} beats={beats} />);
}
renderApp(); // initial render

// --- Login/seed UI ---
(async () => {
  userBadge.textContent = 'Loading...';
  const me = await fetchMe().catch(() => null);

  if (me) {
    userBadge.textContent = `Hi, ${me.display_name || me.id}`;
    loginBtn.style.display = 'none';
    try {
      const data = await searchTracks('Daft Punk');
      renderResults(data.tracks?.items || []);
    } catch (e) {
      console.error(e);
    }
  } else {
    userBadge.textContent = 'Not logged in';
    loginBtn.style.display = 'inline-block';
  }
})();

// --- Spotify Web Playback SDK ---
window.onSpotifyWebPlaybackSDKReady = async () => {
  player = new Spotify.Player({
    name: 'MusicViz Player',
    getOAuthToken: async cb => {
      try {
        const r = await fetch('/token');
        if (!r.ok) return;
        const { access_token } = await r.json();
        cb(access_token);
      } catch {}
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
    }).catch(console.error);
  });

  player.addListener('initialization_error', ({ message }) => console.error('init_err', message));
  player.addListener('authentication_error', ({ message }) => console.error('auth_err', message));
  player.addListener('account_error', ({ message }) => console.error('acct_err', message));
  player.addListener('playback_error', ({ message }) => console.error('playback_err', message));

  await player.connect().catch(console.error);
  renderApp(); // update Visualizer with the real player
};

// --- Search + Play helpers ---
async function searchTracks(query) {
  const url = new URL('/api/search', location.origin);
  url.searchParams.set('q', query);
  const r = await fetch(url);
  if (!r.ok) throw new Error('Search failed');
  return r.json();
}

function artistList(t) {
  return (t.artists || []).map(a => a.name).join(', ');
}

function renderResults(items = []) {
  if (!items.length) {
    results.innerHTML = `<div class="empty">No results. Try a different query.</div>`;
    return;
  }
  results.innerHTML = items.map(t => {
    const artists = artistList(t);
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
  }).catch(console.error);

  // Fetch beats for visualization
  beats = await getBeats(trackId);
  nowPlaying.textContent = 'Playing…';
  renderApp(); // re-render Visualizer with new beats
});

playBtn.addEventListener('click', async () => {
  if (!player) return;
  try { await player.resume(); } catch (e) { console.error(e); }
});
pauseBtn.addEventListener('click', async () => {
  if (!player) return;
  try { await player.pause(); } catch (e) { console.error(e); }
});

searchForm.addEventListener('submit', async (e) => {
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

// --- Minimal auth helper (stub) ---
async function fetchMe() {
  try {
    const r = await fetch('/api/me');
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

// Optional: handle viewport resize for layout (Visualizer handles its own canvas DPI)
window.addEventListener('resize', () => {});