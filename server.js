
const express = require("express");
const http = require("http");
const crypto = require("crypto");
const { WebSocketServer, WebSocket } = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 10;
const CREATOR_CODE = process.env.CREATOR_CODE;

const players = new Map();
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
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(data) {
  const message = JSON.stringify(data);

  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

function broadcastPlayers() {
  broadcast({
    type: "players",
    players: Array.from(players.values())
  });
}

function safeCodeEquals(input, expected) {
  if (typeof input !== "string" ||
      typeof expected !== "string" ||
      input.length === 0 ||
      expected.length === 0) {
    return false;
  }

  const a = Buffer.from(input, "utf8");
  const b = Buffer.from(expected, "utf8");

  return a.length === b.length &&
    crypto.timingSafeEqual(a, b);
}

wss.on("connection", (ws) => {
  if (players.size >= MAX_PLAYERS) {
    send(ws, {
      type: "error",
      message: "Сервер заполнен. Попробуй позже."
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

    if (!msg || typeof msg.type !== "string") {
      return;
    }

    // Перемещение игрока
    if (msg.type === "move") {
      const current = players.get(id);
      if (!current) return;

      for (const key of ["x", "y", "z"]) {
        const value = Number(msg[key]);

        if (!Number.isFinite(value)) return;
        if (Math.abs(value) > 1000000) return;

        current[key] = value;
      }

      broadcastPlayers();
      return;
    }

    // Изменение имени
    if (msg.type === "setName") {
      const current = players.get(id);
      if (!current || typeof msg.name !== "string") return;

      const name = msg.name.trim().slice(0, 24);
      if (!name) return;

      current.name = name;
      broadcastPlayers();
      return;
    }

    // Вход создателя
    if (msg.type === "creatorLogin") {
      if (!CREATOR_CODE) {
        send(ws, {
          type: "creatorLoginResult",
          success: false,
          message: "Код создателя не настроен на сервере"
        });
        return;
      }

      if (!safeCodeEquals(msg.code, CREATOR_CODE)) {
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

    // Выдача монет создателем
    if (msg.type === "creatorGrant") {
      const savedToken = creatorSessions.get(ws);

      if (
        !savedToken ||
        typeof msg.token !== "string" ||
        !safeCodeEquals(msg.token, savedToken)
      ) {
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
          message: "Игрок не найден или отключился"
        });
        return;
      }

      if (
        !Number.isSafeInteger(amount) ||
        amount < 1 ||
        amount > 1000000
      ) {
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
          message: "Слишком большое количество монет"
        });
        return;
      }

      target.coins += amount;

      // Сообщаем создателю об успешной выдаче
      send(ws, {
        type: "creatorGrantResult",
        success: true,
        playerId: target.id,
        amount,
        coins: target.coins,
        message: "Монеты выданы"
      });

      // Обновляем баланс получателя
      for (const client of wss.clients) {
        if (client.readyState !== WebSocket.OPEN) continue;

        const clientPlayer = Array.from(players.values())
          .find(p => p.id === target.id);

        if (clientPlayer && client === ws) {
          // Не отправляем баланс другого игрока создателю
          continue;
        }
      }

      // Отправляем обновлённый баланс только нужному игроку
      // Сокет получателя хранится ниже в playerSockets
      const recipient = playerSockets.get(target.id);

      if (recipient) {
        send(recipient, {
          type: "coinsUpdate",
          coins: target.coins
        });
      }

      broadcastPlayers();
      return;
    }
  });

  ws.on("close", () => {
    players.delete(id);
    creatorSessions.delete(ws);
    playerSockets.delete(id);
    broadcastPlayers();
  });

  ws.on("error", () => {
    // Соединение закрывается обработчиком close
  });
});

// Сокет каждого игрока нужен для персональных обновлений баланса
const playerSockets = new Map();

// Запоминаем сокет после подключения
wss.on("connection", (ws) => {
  const player = Array.from(players.values()).find(
    p => !playerSockets.has(p.id)
  );

  if (player) {
    playerSockets.set(player.id, ws);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("BERDA SURVIVAL SERVER running on port " + PORT);
});
        
