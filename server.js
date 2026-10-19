
const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.get("/", (req, res) => {
  res.send("BERDA SURVIVAL SERVER ONLINE");
});

const players = new Map();

wss.on("connection", (ws) => {
  if (players.size >= 10) {
    ws.close(1008, "Server is full");
    return;
  }

  const id = Math.random().toString(36).slice(2, 10);

  players.set(id, { id, x: 0, y: 0, z: 0, health: 100 });

  const sendPlayers = () => {
    const data = JSON.stringify({
      type: "players",
      players: Array.from(players.values())
    });

    wss.clients.forEach(client => {
      if (client.readyState === 1) client.send(data);
    });
  };

  ws.send(JSON.stringify({
    type: "welcome",
    id,
    players: Array.from(players.values())
  }));

  sendPlayers();

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === "move") {
        const player = players.get(id);
        if (!player) return;

        player.x = Number(msg.x) || 0;
        player.y = Number(msg.y) || 0;
        player.z = Number(msg.z) || 0;

        sendPlayers();
      }
    } catch (error) {}
  });

  ws.on("close", () => {
    players.delete(id);
    sendPlayers();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log("BERDA SURVIVAL running on port " + PORT);
});
