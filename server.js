const https = require("https");
const fs = require("fs");
const express = require("express");
const SpotifyWebApi = require("spotify-web-api-node");
const path = require("path");
require("dotenv").config();

const app = express();

// ---- Spotify setup ----
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.SPOTIFY_REDIRECT_URI,
});

// Home route
app.get("/", (req, res) => {
  res.send(`
    <h1>MusicViz</h1>
    <p><a href="/login">Log in with Spotify</a></p>
  `);
});

// Step 1: Redirect user to Spotify login
app.get("/login", (req, res) => {
  const scopes = [
    "user-read-playback-state",
    "user-read-currently-playing",
    "user-read-recently-played",
    "user-top-read"
  ];

  const authorizeURL = spotifyApi.createAuthorizeURL(scopes, "musicviz-state");
  res.redirect(authorizeURL);
});

// Step 2: Spotify redirects back here with ?code=
app.get("/callback", async (req, res) => {
  const code = req.query.code;

  if (!code) {
    return res.status(400).send("No code provided from Spotify");
  }

  try {
    const data = await spotifyApi.authorizationCodeGrant(code);

    const accessToken = data.body["access_token"];
    const refreshToken = data.body["refresh_token"];

    spotifyApi.setAccessToken(accessToken);
    spotifyApi.setRefreshToken(refreshToken);

    // Example: fetch user's top 10 tracks
    const topTracksResponse = await spotifyApi.getMyTopTracks({ limit: 10 });

    // Instead of dumping JSON, send user to the visualizer page
    res.redirect("/visualizer");
  } catch (err) {
    console.error("Error during Spotify callback:", err);
    res.status(500).send("Error during Spotify authentication");
  }

});

// ---- API route: current track + audio features ----
app.get("/now-playing", async (req, res) => {
  try {
    const current = await spotifyApi.getMyCurrentPlayingTrack();

    if (!current.body || !current.body.item) {
      return res.json({ playing: false });
    }

    const track = current.body.item;
    const progressMs = current.body.progress_ms;
    const isPlaying = current.body.is_playing;

    // Get audio features (energy, tempo, valence, etc.)
    const featuresResponse = await spotifyApi.getAudioFeaturesForTrack(track.id);
    const features = featuresResponse.body;

    res.json({
      playing: isPlaying,
      track: {
        id: track.id,
        name: track.name,
        artists: track.artists.map(a => a.name).join(", "),
        album: track.album.name
      },
      progressMs,
      durationMs: track.duration_ms,
      features: {
        energy: features.energy,
        tempo: features.tempo,
        valence: features.valence,
        danceability: features.danceability
      }
    });
  } catch (err) {
    console.error("Error in /now-playing:", err);
    res.status(500).json({ error: "Failed to fetch now playing" });
  }
});

// ---- Visualizer page ----
app.get("/visualizer", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "visualizer.html"));
});

// ---- HTTPS SERVER ----
const httpsOptions = {
  key: fs.readFileSync("cert/server.key"),
  cert: fs.readFileSync("cert/server.cert"),
};

https.createServer(httpsOptions, app).listen(8443, "127.0.0.1", () => {
  console.log("HTTPS server running at https://127.0.0.1:8443/");
});

