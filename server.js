import 'dotenv/config';
import fs from 'fs';
import http from 'http';
import https from 'https';
import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REDIRECT_URI = 'https://127.0.0.1:8443/callback',
  PORT = 8443,
  HOST = '127.0.0.1',
  SESSION_SECRET = 'change_me'
} = process.env;

if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
  console.error('Missing Spotify credentials in .env');
  process.exit(1);
}

const app = express();
app.use(express.json());

// Session (store tokens here; for production use a persistent store)
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // set true behind a real proxy/https with trust proxy
  })
);

// Static
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders: (res) => res.set('Cache-Control', 'no-store')
  })
);

// ---- OAuth helpers ----
async function exchangeCodeForTokens(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: SPOTIFY_REDIRECT_URI
  });

  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const text = await resp.text(); // capture error payload for logging
  if (!resp.ok) {
    console.error('🔴 Token exchange error', resp.status, text);
    throw new Error(`Token exchange failed: ${resp.status}`);
  }
  return JSON.parse(text);
}

async function refreshAccessToken(refresh_token) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token
  });

  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const text = await resp.text();
  if (!resp.ok) {
    console.error('🔴 Refresh error', resp.status, text);
    throw new Error(`Refresh failed: ${resp.status}`);
  }
  return JSON.parse(text);
}

function isExpired(sess) {
  return !sess.spotify || Date.now() > (sess.spotify.expires_at || 0) - 10_000;
}

async function ensureAccessToken(req) {
  const sess = req.session;
  if (!sess.spotify?.access_token) return null;

  if (isExpired(sess)) {
    const data = await refreshAccessToken(sess.spotify.refresh_token);
    sess.spotify.access_token = data.access_token;
    if (data.refresh_token) sess.spotify.refresh_token = data.refresh_token; // sometimes returned
    sess.spotify.expires_at = Date.now() + data.expires_in * 1000;
  }
  return sess.spotify.access_token;
}

// ---- Routes: Auth ----
app.get('/login', (req, res) => {
  const scope = [
    'streaming',
    'user-read-email',
    'user-read-private',
    'user-modify-playback-state',
    'user-read-playback-state'
  ].join(' ');

  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: SPOTIFY_REDIRECT_URI,
    scope
  });

  const url = `https://accounts.spotify.com/authorize?${params.toString()}`;
  console.log('➡️  Authorize URL:', url);
  res.redirect(url);
});

app.get('/callback', async (req, res) => {
  try {
    const code = req.query.code?.toString();
    if (!code) return res.status(400).send('Missing code');

    console.log('↩️  Callback hit. Using redirect_uri =', SPOTIFY_REDIRECT_URI);

    const data = await exchangeCodeForTokens(code);
    req.session.spotify = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000
    };
    res.redirect('/');
  } catch (e) {
    console.error(e);
    res.status(500).send('Auth failed');
  }
});

// The SDK calls this to get a fresh token
app.get('/token', async (req, res) => {
  try {
    const token = await ensureAccessToken(req);
    if (!token) return res.status(401).json({ error: 'not_logged_in' });
    res.json({ access_token: token });
  } catch (e) {
    res.status(500).json({ error: 'token_error' });
  }
});

// --- Logout / clear tokens ---
let cachedClientToken = typeof cachedClientToken === 'undefined' ? null : cachedClientToken;
let clientTokenExpires = typeof clientTokenExpires === 'undefined' ? 0 : clientTokenExpires;

function clearTokenCaches() {
  cachedClientToken = null;
  clientTokenExpires = 0;
  // If you also had preview-mode vars, clear them too:
  // if (typeof cachedToken !== 'undefined') cachedToken = null;
  // if (typeof tokenExpiresAt !== 'undefined') tokenExpiresAt = 0;
}

app.post('/logout', (req, res) => {
  try {
    clearTokenCaches();
    req.session.destroy(err => {
      if (err) return res.status(500).json({ error: 'logout_failed' });
      res.clearCookie('connect.sid'); // change if you renamed the session cookie
      return res.sendStatus(204);
    });
  } catch {
    return res.status(500).json({ error: 'logout_error' });
  }
});

// Optional convenience GET for manual testing
app.get('/logout', (req, res) => {
  clearTokenCaches();
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

// ---- API: Me (login status) ----
app.get('/api/me', async (req, res) => {
  try {
    const token = await ensureAccessToken(req);
    if (!token) return res.status(401).json({ error: 'not_logged_in' });
    const r = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const j = await r.json();
    res.status(r.status).json(j);
  } catch (e) {
    res.status(500).json({ error: 'me_failed' });
  }
});

// ---- API: search (user token preferred; falls back to client credentials) ----
async function clientCredentialsToken() {
  const now = Date.now();
  if (cachedClientToken && now < clientTokenExpires - 10_000) return cachedClientToken;
  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization:
        'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' })
  });
  const data = await resp.json();
  cachedClientToken = data.access_token;
  clientTokenExpires = Date.now() + data.expires_in * 1000;
  return cachedClientToken;
}

app.get('/api/search', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.status(400).json({ error: 'missing_q' });

    let token = await ensureAccessToken(req);
    if (!token) token = await clientCredentialsToken();

    const url = new URL('https://api.spotify.com/v1/search');
    url.searchParams.set('q', q);
    url.searchParams.set('type', 'track');
    url.searchParams.set('limit', '12');

    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    res.status(r.status).json(j);
  } catch (e) {
    res.status(500).json({ error: 'search_failed' });
  }
});

// ---- API: audio analysis (for beats) ----
app.get('/api/analysis/:id', async (req, res) => {
  try {
    const token = await ensureAccessToken(req);
    if (!token) return res.status(401).json({ error: 'not_logged_in' });
    const r = await fetch(`https://api.spotify.com/v1/audio-analysis/${req.params.id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const j = await r.json();
    res.status(r.status).json(j);
  } catch (e) {
    res.status(500).json({ error: 'analysis_failed' });
  }
});

// ---- API: control playback ----
app.post('/api/transfer', async (req, res) => {
  try {
    const token = await ensureAccessToken(req);
    if (!token) return res.status(401).json({ error: 'not_logged_in' });

    const { device_id } = req.body || {};
    const r = await fetch('https://api.spotify.com/v1/me/player', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_ids: [device_id], play: false })
    });
    res.sendStatus(r.status === 204 ? 204 : r.status);
  } catch (e) {
    res.status(500).json({ error: 'transfer_failed' });
  }
});

app.post('/api/play', async (req, res) => {
  try {
    const token = await ensureAccessToken(req);
    if (!token) return res.status(401).json({ error: 'not_logged_in' });

    const { device_id, uri } = req.body || {};
    if (!device_id || !uri) return res.status(400).json({ error: 'missing_params' });

    const r = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(device_id)}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [uri] })
    });
    res.sendStatus(r.status === 204 ? 204 : r.status);
  } catch (e) {
    res.status(500).json({ error: 'play_failed' });
  }
});

// Root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- HTTPS boot (with HTTP fallback) ----
function startServer() {
  const wantsHttps = process.argv.includes('--https') || !process.argv.includes('--http');
  const certDir = path.join(__dirname, 'certs');
  const keyPath = path.join(certDir, 'server.key');
  const crtPath = path.join(certDir, 'server.crt');

  if (wantsHttps && fs.existsSync(keyPath) && fs.existsSync(crtPath)) {
    const options = { key: fs.readFileSync(keyPath), cert: fs.readFileSync(crtPath) };
    https.createServer(options, app).listen(PORT, HOST, () => {
      console.log(`✅ HTTPS server on https://${HOST}:${PORT}`);
    });
  } else {
    const httpPort = process.env.HTTP_PORT || 8080;
    http.createServer(app).listen(httpPort, HOST, () => {
      console.log(`⚠️  HTTP on http://${HOST}:${httpPort}`);
    });
  }
}

startServer();
