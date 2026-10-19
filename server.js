
const express = require("express");
const http = require("http");
const crypto = require("crypto");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 10;
const players = new Map();
const playerSockets = new Map();
const creatorSessions = new Map();

app.get("/", (req, res) => {
  res.status(200).send("BERDA SURVIVAL SERVER ONLINE");
});

app.get("/health", (req, res) => {
  res.json({
    status: "online",
    players: players.size,
    maxPlayers: MAX_PLAYERS
  });
});

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(data) {
  const text = JSON.stringify(data);

  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(text);
    }
  }
}

function broadcastPlayers() {
  broadcast({
    type: "players",
    players: Array.from(players.values())
  });
}

function safeEquals(value, expected) {
  if (typeof value !== "string" ||
      typeof expected !== "string") {
    return false;
  }

  const a = Buffer.from(value, "utf8");
  const b = Buffer.from(expected, "utf8");

  return a.length === b.length &&
    a.length > 0 &&
    crypto.timingSafeEqual(a, b);
}

function getPlayer(ws) {
  for (const [id, socket] of playerSockets.entries()) {
    if (socket === ws) return players.get(id);
  }

  return null;
}

wss.on("connection", (ws) => {
  if (players.size >= MAX_PLAYERS) {
    send(ws, {
      type: "error",
      message: "Сервер заполнен"
    });

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
  playerSockets.set(id, ws);

  send(ws, {
    type: "welcome",
    id,
    players: Array.from(players.values())
  });

  broadcastPlayers();

  ws.on("message", (raw) => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, {
        type: "error",
        message: "Некорректное сообщение"
      });
      return;
    }

    if (!msg || typeof msg.type !== "string") return;

    // Обновление позиции игрока
    if (msg.type === "move") {
      const current = getPlayer(ws);
      if (!current) return;

      const position = {};

      for (const key of ["x", "y", "z"]) {
        const value = Number(msg[key]);

        if (!Number.isFinite(value) ||
            Math.abs(value) > 1000000) {
          return;
        }

        position[key] = value;
      }

      current.x = position.x;
      current.y = position.y;
      current.z = position.z;

      broadcastPlayers();
      return;
    }

    // Изменение имени
    if (msg.type === "setName") {
      const current = getPlayer(ws);

      if (!current || typeof msg.name !== "string") {
        return;
      }

      const name = msg.name.trim().slice(0, 24);
      if (!name) return;

      current.name = name;
      broadcastPlayers();
      return;
    }

    // Вход создателя
    if (msg.type === "creatorLogin") {
      const expected = process.env.CREATOR_CODE;

      if (!expected) {
        send(ws, {
          type: "creatorLoginResult",
          success: false,
          message: "Код создателя не настроен на сервере"
        });
        return;
      }

      if (!safeEquals(msg.code, expected)) {
        send(ws, {
          type: "creatorLoginResult",
          success: false,
          message: "Неверный код создателя"
        });
        return;
      }

      const token = crypto.randomBytes(32).toString("hex");
      creatorSessions.set(ws, token);

      send(ws, {
        type: "creatorLoginResult",
        success: true,
        token
      });

      return;
    }

    // Выдача монет
    if (msg.type === "creatorGrant") {
      const savedToken = creatorSessions.get(ws);

      if (!savedToken ||
          !safeEquals(msg.token, savedToken)) {
        send(ws, {
          type: "creatorGrantResult",
          success: false,
          message: "Нет прав создателя. Войди заново."
        });
        return;
      }

      const target = players.get(String(msg.playerId));
      const amount = Number(msg.amount);

      if (!target) {
        send(ws, {
          type: "creatorGrantResult",
          success: false,
          message: "Игрок не найден"
        });
        return;
      }

      if (!Number.isSafeInteger(amount) ||
          amount < 1 ||
          amount > 1000000) {
        send(ws, {
          type: "creatorGrantResult",
          success: false,
          message: "Недопустимое количество монет"
        });
        return;
      }

      if (!Number.isSafeInteger(target.coins + amount)) {
        send(ws, {
          type: "creatorGrantResult",
          success: false,
          message: "Слишком большой баланс"
        });
        return;
      }

      target.coins += amount;

      send(ws, {
        type: "creatorGrantResult",
        success: true,
        playerId: target.id,
        amount,
        coins: target.coins,
        message: "Монеты выданы"
      });

      const targetSocket = playerSockets.get(target.id);

      send(targetSocket, {
        type: "coinsUpdate",
        coins: target.coins
      });

      broadcastPlayers();
      return;
    }
  });

  ws.on("close", () => {
    players.delete(id);
    playerSockets.delete(id);
    creatorSessions.delete(ws);
    broadcastPlayers();
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error.message);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("BERDA SURVIVAL SERVER running on port " + PORT);
});
