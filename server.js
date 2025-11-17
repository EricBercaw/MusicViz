const https = require("https");
const fs = require("fs");
const express = require("express");
const SpotifyWebApi = require("spotify-web-api-node");
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
  res.send('<h1>MusicViz</h1><a href="/login">Log in with Spotify</a>');
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

    res.send(`
      <h1>Logged in with Spotify!</h1>
      <p>Here are your top tracks (raw JSON for now):</p>
      <pre>${JSON.stringify(topTracksResponse.body, null, 2)}</pre>
    `);
  } catch (err) {
    console.error("Error during Spotify callback:", err);
    res.status(500).send("Error during Spotify authentication");
  }
});

// ---- HTTPS setup ----
const options = {
  key: fs.readFileSync("cert/server.key"),
  cert: fs.readFileSync("cert/server.cert")
};

https.createServer(options, app).listen(3000, () => {
  console.log("HTTPS server running at https://localhost:3000");
});


