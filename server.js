const https = require("https");
const fs = require("fs");
const express = require("express");

const app = express();

app.get("/", (req, res) => {
  res.send("Hello from Node HTTPS server!");
});

const options = {
  key: fs.readFileSync("localhost-key.pem"),
  cert: fs.readFileSync("localhost.pem"),
};

https.createServer(options, app).listen(3000, () => {
  console.log("HTTPS server running at https://localhost:3000");
});


