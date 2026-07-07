const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const db = require("./db");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || "0.0.0.0";

function parseAllowedOrigins() {
  const raw = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const allowedOrigins = parseAllowedOrigins();

function isOriginAllowed(origin) {
  if (!origin) return true;
  return allowedOrigins.includes(origin);
}

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  },
});

app.use(
  cors({
    origin(origin, callback) {
      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
  })
);
app.use(express.json({ limit: "10mb" }));

const roomPresence = new Map();

function generateRoomId() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function generateBoardId() {
  return crypto.randomUUID();
}

function getRoomElements(roomId) {
  const row = db.prepare("SELECT elements FROM rooms WHERE id = ?").get(roomId);
  if (!row) return [];
  try {
    return JSON.parse(row.elements);
  } catch {
    return [];
  }
}

function saveRoomElements(roomId, elements) {
  const payload = JSON.stringify(elements);
  db.prepare(
    `
    INSERT INTO rooms (id, elements, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      elements = excluded.elements,
      updated_at = excluded.updated_at
  `
  ).run(roomId, payload);
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", app: "InkFlow" });
});

app.post("/api/rooms", (_req, res) => {
  let roomId = generateRoomId();
  let attempts = 0;
  while (db.prepare("SELECT id FROM rooms WHERE id = ?").get(roomId) && attempts < 10) {
    roomId = generateRoomId();
    attempts += 1;
  }
  saveRoomElements(roomId, []);
  res.status(201).json({ roomId });
});

app.get("/api/rooms/:roomId", (req, res) => {
  const { roomId } = req.params;
  const row = db.prepare("SELECT id, elements, updated_at FROM rooms WHERE id = ?").get(roomId);
  if (!row) {
    return res.status(404).json({ error: "Room not found." });
  }
  let elements = [];
  try {
    elements = JSON.parse(row.elements);
  } catch {
    elements = [];
  }
  res.json({ roomId: row.id, elements, updatedAt: row.updated_at });
});

app.get("/api/boards", (_req, res) => {
  const rows = db
    .prepare(
      `
      SELECT id, name, updated_at as updatedAt
      FROM boards
      ORDER BY updated_at DESC
      LIMIT 50
    `
    )
    .all();
  res.json({ items: rows });
});

app.get("/api/boards/:id", (req, res) => {
  const row = db
    .prepare("SELECT id, name, elements, updated_at as updatedAt FROM boards WHERE id = ?")
    .get(req.params.id);
  if (!row) {
    return res.status(404).json({ error: "Board not found." });
  }
  let elements = [];
  try {
    elements = JSON.parse(row.elements);
  } catch {
    elements = [];
  }
  res.json({ ...row, elements });
});

app.post("/api/boards", (req, res) => {
  const { name, elements } = req.body || {};
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Board name is required." });
  }
  if (!Array.isArray(elements)) {
    return res.status(400).json({ error: "Elements must be an array." });
  }
  const id = generateBoardId();
  db.prepare(
    `
    INSERT INTO boards (id, name, elements)
    VALUES (?, ?, ?)
  `
  ).run(id, name.trim().slice(0, 80), JSON.stringify(elements));
  res.status(201).json({ id, name: name.trim().slice(0, 80) });
});

app.put("/api/boards/:id", (req, res) => {
  const { name, elements } = req.body || {};
  const existing = db.prepare("SELECT id FROM boards WHERE id = ?").get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: "Board not found." });
  }
  if (!Array.isArray(elements)) {
    return res.status(400).json({ error: "Elements must be an array." });
  }
  const safeName =
    typeof name === "string" && name.trim() ? name.trim().slice(0, 80) : undefined;
  if (safeName) {
    db.prepare(
      `
      UPDATE boards
      SET name = ?, elements = ?, updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(safeName, JSON.stringify(elements), req.params.id);
  } else {
    db.prepare(
      `
      UPDATE boards
      SET elements = ?, updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(JSON.stringify(elements), req.params.id);
  }
  res.json({ ok: true });
});

app.delete("/api/boards/:id", (req, res) => {
  const result = db.prepare("DELETE FROM boards WHERE id = ?").run(req.params.id);
  if (!result.changes) {
    return res.status(404).json({ error: "Board not found." });
  }
  res.json({ ok: true });
});

io.on("connection", (socket) => {
  let currentRoom = null;
  let userName = "Guest";

  socket.on("joinRoom", ({ roomId, name }) => {
    if (!roomId || typeof roomId !== "string") return;

    if (currentRoom) {
      socket.leave(currentRoom);
      removePresence(currentRoom, socket.id);
    }

    currentRoom = roomId.toUpperCase();
    userName = typeof name === "string" && name.trim() ? name.trim().slice(0, 24) : "Guest";
    socket.join(currentRoom);

    const color = hashColor(socket.id);
    const presence = {
      id: socket.id,
      name: userName,
      color,
      x: 0,
      y: 0,
    };

    if (!roomPresence.has(currentRoom)) {
      roomPresence.set(currentRoom, new Map());
    }
    roomPresence.get(currentRoom).set(socket.id, presence);

    const elements = getRoomElements(currentRoom);
    socket.emit("roomState", { elements, presence: listPresence(currentRoom) });
    socket.to(currentRoom).emit("userJoined", presence);
  });

  socket.on("cursorMove", ({ x, y }) => {
    if (!currentRoom) return;
    const room = roomPresence.get(currentRoom);
    if (!room || !room.has(socket.id)) return;
    const user = room.get(socket.id);
    user.x = x;
    user.y = y;
    socket.to(currentRoom).emit("cursorUpdate", { id: socket.id, x, y });
  });

  socket.on("drawingUpdate", ({ elements }) => {
    if (!currentRoom || !Array.isArray(elements)) return;
    saveRoomElements(currentRoom, elements);
    socket.to(currentRoom).emit("drawingUpdate", { elements });
  });

  socket.on("disconnect", () => {
    if (!currentRoom) return;
    removePresence(currentRoom, socket.id);
    socket.to(currentRoom).emit("userLeft", { id: socket.id });
    currentRoom = null;
  });
});

function listPresence(roomId) {
  const room = roomPresence.get(roomId);
  if (!room) return [];
  return Array.from(room.values());
}

function removePresence(roomId, socketId) {
  const room = roomPresence.get(roomId);
  if (!room) return;
  room.delete(socketId);
  if (room.size === 0) {
    roomPresence.delete(roomId);
  }
}

function hashColor(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = input.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 75% 55%)`;
}

server.listen(PORT, HOST, () => {
  console.log(`InkFlow backend running on http://${HOST}:${PORT}`);
  console.log(`Allowed origins: ${allowedOrigins.join(", ")}`);
});
