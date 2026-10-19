
const express = require("express");
const http = require("http");
const crypto = require("crypto");
const { WebSocketServer, WebSocket } = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.get("/", (req, res) => {
  res.send("BERDA SURVIVAL SERVER ONLINE");
});

const players = new Map();
const creatorSessions = new Map();
const MAX_PLAYERS = 10;
const MAX_GRANT = 1000000;

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcastPlayers() {
  const data = JSON.stringify({
    type: "players",
    players: Array.from(players.values())
  });

  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

wss.on("connection", (ws) => {
  if (players.size >= MAX_PLAYERS) {
    ws.close(1008, "Server is full");
    return;
  }

  const id = crypto.randomUUID();
  const player = {
    id,
    name: "Выживший",
    x: 0,
    y: 0,
    z: 0,
    health: 100,
    coins: 0
  };

  players.set(id, player);

  send(ws, {
    type: "welcome",
    id,
    players: Array.from(players.values())
  });

  broadcastPlayers();

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (!msg || typeof msg.type !== "string") return;

      if (msg.type === "move") {
        const p = players.get(id);
        if (!p) return;

        for (const axis of ["x", "y", "z"]) {
          const n = Number(msg[axis]);
          if (Number.isFinite(n)) {
            p[axis] = Math.max(-100000, Math.min(100000, n));
          }
        }

        broadcastPlayers();
      }

      else if (msg.type === "setName") {
        const name = String(msg.name || "")
          .replace(/[<>]/g, "")
          .trim()
          .slice(0, 20);

        if (name.length < 2) {
          send(ws, { type: "error", message: "Ник слишком короткий" });
          return;
        }

        player.name = name;
        broadcastPlayers();
      }

      else if (msg.type === "creatorLogin") {
        const expected = process.env.CREATOR_CODE;

        if (!expected || typeof msg.code !== "string") {
          send(ws, {
            type: "creatorLoginResult",
            ok: false,
            message: "Код автора не настроен на сервере"
          });
          return;
        }

        const a = Buffer.from(msg.code);
        const b = Buffer.from(expected);

        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
          send(ws, {
            type: "creatorLoginResult",
            ok: false,
            message: "Неверный код автора"
          });
          return;
        }

        const token = crypto.randomBytes(32).toString("hex");
        creatorSessions.set(ws, token);

        send(ws, {
          type: "creatorLoginResult",
          ok: true,
          token
        });
      }

      else if (msg.type === "creatorGrant") {
        const token = creatorSessions.get(ws);

        if (!token || typeof msg.token !== "string" ||
            token !== msg.token) {
          send(ws, {
            type: "creatorGrantResult",
            ok: false,
            message: "Нет прав создателя"
          });
          return;
        }

        const target = players.get(String(msg.playerId || ""));
        const amount = Number(msg.amount);

        if (!target) {
          send(ws, {
            type: "creatorGrantResult",
            ok: false,
            message: "Игрок не найден или вышел"
          });
          return;
        }

        if (!Number.isSafeInteger(amount) ||
            amount < 1 || amount > MAX_GRANT) {
          send(ws, {
            type: "creatorGrantResult",
            ok: false,
            message: "Укажи целое число от 1 до 1000000"
          });
          return;
        }

        target.coins += amount;

        send(ws, {
          type: "creatorGrantResult",
          ok: true,
          playerId: target.id,
          amount,
          balance: target.coins
        });

        // Уведомляем игрока и обновляем список для всех.
        for (const client of wss.clients) {
          if (client.readyState === WebSocket.OPEN) {
            send(client, {
              type: "coinsUpdate",
              playerId: target.id,
              coins: target.coins
            });
          }
        }

        broadcastPlayers();
      }
    } catch (error) {
      send(ws, {
        type: "error",
        message: "Не удалось обработать сообщение"
      });
    }
  });

  ws.on("close", () => {
    players.delete(id);
    creatorSessions.delete(ws);
    broadcastPlayers();
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log("BERDA SURVIVAL running on port " + PORT);
});
            
