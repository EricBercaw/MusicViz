// ===== CONFIG =====
const CLIENT_ID = "07f3dda064eb4a6c9226822edd2885b7"; // your Spotify app's Client ID
const REDIRECT_URI = "https://localhost:3000/callback";   // MUST exist in Spotify dashboard
const SCOPES = ["user-read-playback-state", "user-read-currently-playing"];

// ===== UTILITIES =====
const $ = (id) => document.getElementById(id);
const msToClock = (ms) => {
  if (!ms || ms < 0) return "0:00";
  const s = Math.floor(ms/1000), m = Math.floor(s/60), r = s%60;
  return `${m}:${r.toString().padStart(2,'0')}`;
};

// ===== PKCE HELPERS =====
const generateRandomString = (length) => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, b => chars[b % chars.length]).join("");
};
const sha256 = async (plain) => {
  const data = new TextEncoder().encode(plain);
  return await crypto.subtle.digest("SHA-256", data);
};
const base64url = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
};

// ===== AUTH (Authorization Code with PKCE) =====
async function login(){
  const state = crypto.getRandomValues(new Uint32Array(4)).join("-");
  localStorage.setItem("spotify_state", state);

  const code_verifier = generateRandomString(64);
  localStorage.setItem("spotify_code_verifier", code_verifier);
  const code_challenge = base64url(await sha256(code_verifier));

  const auth = new URL("https://accounts.spotify.com/authorize");
  auth.searchParams.set("client_id", CLIENT_ID);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("redirect_uri", REDIRECT_URI);
  auth.searchParams.set("scope", SCOPES.join(" "));
  auth.searchParams.set("state", state);
  auth.searchParams.set("code_challenge_method", "S256");
  auth.searchParams.set("code_challenge", code_challenge);
  auth.searchParams.set("show_dialog", "true");

  console.log("Authorize URL:", auth.toString());
  window.location = auth.toString();
}

async function exchangeCodeForToken(code){
  const code_verifier = localStorage.getItem("spotify_code_verifier");
  if (!code_verifier) throw new Error("Missing PKCE code_verifier");

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier
    })
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);

  const data = await res.json();
  const expires_at = Date.now() + data.expires_in * 1000 - 5000;
  const token = { access_token: data.access_token, token_type: data.token_type, expires_at 
};
  localStorage.setItem("spotify_token", JSON.stringify(token));
  if (data.refresh_token) localStorage.setItem("spotify_refresh_token", data.refresh_token);

  history.replaceState({}, document.title, "/index.html"); // return to app shell after 
callback
  return token;
}

function getStoredToken(){
  const raw = localStorage.getItem("spotify_token");
  if (!raw) return null;
  const tok = JSON.parse(raw);
  if (Date.now() > tok.expires_at) return null;
  return tok;
}

async function ensureToken(){
  const existing = getStoredToken();
  if (existing) return existing;

  const params = new URLSearchParams(window.location.search);
  const err = params.get("error");
  if (err) throw new Error("Spotify auth error: " + err);
  const state = params.get("state");
  if (state && state !== localStorage.getItem("spotify_state")) {
    throw new Error("State mismatch; clear storage and try again.");
  }
  const code = params.get("code");
  if (code) return await exchangeCodeForToken(code);
  return null; // not authenticated yet
}

// ===== API CALLS =====
async function api(path, init={}){
  const tok = await ensureToken();
  if (!tok) throw new Error("Not authenticated");
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: { ...(init.headers||{}), Authorization: `Bearer ${tok.access_token}` }
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Spotify API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function me(){
  try {
    const data = await api('/me');
    $("whoami").textContent = `Signed in as ${data.display_name || data.id}`;
  } catch (e) { console.warn(e); }
}

let lastTrackId = null, progressMs = 0, durationMs = 0, isPlaying = false, tickHandle = 
null, pollHandle = null;

async function fetchNowPlaying(){
  try {
    const np = await api('/me/player/currently-playing');
    $("raw").textContent = JSON.stringify(np, null, 2);
    if (!np || !np.item) return;
    const t = np.item;
    lastTrackId = t.id;
    durationMs = t.duration_ms;
    progressMs = np.progress_ms || 0;
    isPlaying = !!np.is_playing;
    $("title").textContent = t.name || '—';
    $("artist").textContent = (t.artists||[]).map(a=>a.name).join(', ');
    $("album").textContent = t.album?.name || '—';
    $("duration").textContent = msToClock(durationMs);
    $("position").textContent = msToClock(progressMs);
    const img = t.album?.images?.[1]?.url || t.album?.images?.[0]?.url;
    if (img) $("art").src = img;
    $("progress").style.width = `${Math.min(100, (progressMs/durationMs)*100)}%`;
    if (lastTrackId) fetchAudioFeatures(lastTrackId);
  } catch (e) { console.error(e); }
}

async function fetchAudioFeatures(trackId){
  try {
    const feat = await api(`/audio-features/${trackId}`);
    $("tempo").textContent = Math.round(feat.tempo);
    $("energy").textContent = feat.energy?.toFixed(2);
    $("danceability").textContent = feat.danceability?.toFixed(2);
    $("valence").textContent = feat.valence?.toFixed(2);
    $("key").textContent = feat.key;
    $("mode").textContent = feat.mode ? 'major' : 'minor';
  } catch (e) { console.warn(e); }
}

function startTicker(){
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = setInterval(()=>{
    if (isPlaying) {
      progressMs += 1000;
      $("position").textContent = msToClock(progressMs);
      $("progress").style.width = `${Math.min(100, (progressMs/durationMs)*100)}%`;
    }
  }, 1000);
}
function startPolling(){
  if (pollHandle) clearInterval(pollHandle);
  pollHandle = setInterval(fetchNowPlaying, 2000);
}

// ===== WIRE UP =====
document.addEventListener('DOMContentLoaded', () => {
  $("btnAuth").addEventListener('click', login);
  $("btnLogout").addEventListener('click', ()=>{
    localStorage.removeItem("spotify_token");
    localStorage.removeItem("spotify_state");
    localStorage.removeItem("spotify_code_verifier");
    localStorage.removeItem("spotify_refresh_token");
    location.href = "/index.html";
  });

  (async function init(){
    try {
      const tok = await ensureToken();
      if (tok) {
        await me();
        await fetchNowPlaying();
        startTicker();
        startPolling();
      }
    } catch (e) {
      console.warn(e);
    }
  })();
});

