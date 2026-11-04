const express = require("express");
const http = require("node:http");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { Server } = require("socket.io");
const session = require("express-session");

const createAuthRouter = require("./auth.cjs");
const createSkillsRouter = require("./skills.cjs");
const createSessionsRouter = require("./sessions.cjs");
const createParticipantsRouter = require("./participants.cjs");
const createChatRouter = require("./chat.cjs");
const createDashboardRouter = require("./dashboard.cjs");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  maxHttpBufferSize: 16 * 1024,
});

const db = new DatabaseSync(
  path.join(__dirname, "playconnect.db")
);

db.exec("PRAGMA foreign_keys = ON");

app.use(express.json({ limit: "16kb" }));

const sessionMiddleware = session({
  name: "playconnect.sid",
  secret:
    process.env.SESSION_SECRET ||
    randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 24 * 60 * 60 * 1000,
  },
});

app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

const authRouter = createAuthRouter(db);
const skillsRouter = createSkillsRouter(db);
const sessionsRouter = createSessionsRouter(db);
const participantsRouter = createParticipantsRouter(db);
const chatRouter = createChatRouter(db, io);
const dashboardRouter = createDashboardRouter(db);

app.use("/api/auth", authRouter);
app.use("/api/skills", skillsRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/sessions", chatRouter);
app.use("/api/sessions", participantsRouter);
app.use("/api/sessions", sessionsRouter);

app.get("/api/health", (req, res) => {
  const result = db.prepare(
    "SELECT 1 AS connected"
  ).get();

  res.json({
    message: "PlayConnect backend is running!",
    database:
      result.connected === 1 ? "Connected" : "Disconnected",
  });
});

app.use("/api", (req, res) => {
  res.status(404).json({
    error: "API endpoint not found.",
  });
});

app.use((error, req, res, next) => {
  console.error(error);

  if (error.type === "entity.parse.failed") {
    return res.status(400).json({
      error: "Invalid JSON request.",
    });
  }

  if (error.type === "entity.too.large") {
    return res.status(413).json({
      error: "Request is too large.",
    });
  }

  res.status(500).json({
    error: "Something went wrong. Please try again.",
  });
});

server.listen(3001, () => {
  console.log(
    "PlayConnect backend: http://localhost:3001"
  );
});