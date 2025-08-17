import 'dotenv/config';
import fs from 'fs';
import http from 'http';
import https from 'https';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  PORT = 8443,
  HOST = 'localhost'
} = process.env;

if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
  console.error('Missing Spotify credentials in .env');
  process.exit(1);
}

const app = express();

// --- Static files ---
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => {
    // Help some CSS issues with caching during dev
    res.set('Cache-Control', 'no-store');
  }
}));

// --- Simple in-memory token cache ---
let cachedToken = null;
let tokenExpiresAt = 0;

async function getSpotifyToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 10_000) {
    return cachedToken;
  }
  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization':
        'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' })
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token error: ${resp.status} ${text}`);
  }
  const data = await resp.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return cachedToken;
}

// --- API: search tracks (uses client credentials) ---
app.get('/api/search', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.status(400).json({ error: 'Missing q' });
    const token = await getSpotifyToken();
    const url = new URL('https://api.spotify.com/v1/search');
    url.searchParams.set('q', q);
    url.searchParams.set('type', 'track');
    url.searchParams.set('limit', '12');
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const json = await r.json();
    res.json(json);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'search_failed' });
  }
});

// --- API: track detail (to fetch preview_url reliably) ---
app.get('/api/track/:id', async (req, res) => {
  try {
    const token = await getSpotifyToken();
    const r = await fetch(`https://api.spotify.com/v1/tracks/${req.params.id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const json = await r.json();
    res.json(json);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'track_failed' });
  }
});

// --- Fallback to index.html for root ---
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- HTTPS boot (with HTTP fallback) ---
function startServer() {
  const wantsHttps = process.argv.includes('--https') || !process.argv.includes('--http');
  const certDir = path.join(__dirname, 'certs');
  const keyPath = path.join(certDir, 'server.key');
  const crtPath = path.join(certDir, 'server.crt');

  if (wantsHttps && fs.existsSync(keyPath) && fs.existsSync(crtPath)) {
    const options = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(crtPath)
    };
    https.createServer(options, app).listen(PORT, HOST, () => {
      console.log(`✅ HTTPS server on https://${HOST}:${PORT}`);
    });
  } else {
    const httpPort = process.env.HTTP_PORT || 8080;
    http.createServer(app).listen(httpPort, HOST, () => {
      console.log(`⚠️  Starting HTTP on http://${HOST}:${httpPort} (no certs found or --http used)`);
      console.log('Tip: place certs in ./certs and run with --https for secure context.');
    });
  }
}

startServer();
