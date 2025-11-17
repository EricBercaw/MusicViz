const https = require("https");
const fs = require("fs");
const express = require("express");

const app = express();

app.get("/", (req, res) => {
  res.send("Hello from Node HTTPS server!");
});

const options = {
  key: fs.readFileSync("cert/server.key"),
  cert: fs.readFileSync("cert/server.cert"),
};

https.createServer(options, app).listen(3000, () => {
  console.log("HTTPS server running at https://localhost:3000");
});

