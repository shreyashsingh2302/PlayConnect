const express = require("express");

module.exports = function createChatRouter(db, io) {
  const router = express.Router();

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session_id
    ON messages(session_id, id);
  `);

  function validId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  function accessError(userId, sessionId) {
    if (
      !userId ||
      !db.prepare("SELECT id FROM users WHERE id = ?").get(userId)
    ) {
      return "Please sign in again.";
    }

    const session = db
      .prepare(
        "SELECT host_id, status, completed_at FROM sessions WHERE id = ?"
      )
      .get(sessionId);

    if (!session) return "This session no longer exists.";

    if (session.completed_at) {
      return "This session is completed. Its chat is closed.";
    }

    if (session.status !== "Open") {
      return "This session has been cancelled. Its chat is closed.";
    }

    if (Number(session.host_id) === Number(userId)) return null;

    const membership = db
      .prepare(`
        SELECT status
        FROM participants
        WHERE session_id = ? AND user_id = ?
      `)
      .get(sessionId, userId);

    if (membership?.status !== "Accepted") {
      return "Only the host and accepted players can use this chat.";
    }

    return null;
  }

  function recentMessages(sessionId) {
    return db
      .prepare(`
        SELECT *
        FROM (
          SELECT
            m.id,
            m.session_id,
            m.user_id,
            m.content,
            m.created_at,
            u.name AS sender_name
          FROM messages m
          JOIN users u ON u.id = m.user_id
          WHERE m.session_id = ?
          ORDER BY m.id DESC
          LIMIT 100
        )
        ORDER BY id ASC
      `)
      .all(sessionId);
  }

  function getMessage(id) {
    return db
      .prepare(`
        SELECT
          m.id,
          m.session_id,
          m.user_id,
          m.content,
          m.created_at,
          u.name AS sender_name
        FROM messages m
        JOIN users u ON u.id = m.user_id
        WHERE m.id = ?
      `)
      .get(id);
  }

  function reloadUser(socket) {
    return new Promise((resolve) => {
      const session = socket.request.session;

      if (!session || typeof session.reload !== "function") {
        resolve(null);
        return;
      }

      session.reload((error) => {
        if (error) {
          resolve(null);
          return;
        }

        resolve(validId(socket.request.session?.userId));
      });
    });
  }

  function denyChat(socket, error) {
    socket.data.chatSessionId = null;
    socket.emit("chat:denied", { error });
  }

  async function deliverMessage(message) {
    await Promise.all(
      [...io.sockets.sockets.values()].map(async (socket) => {
        if (socket.data.chatSessionId !== message.session_id) return;

        try {
          const userId = await reloadUser(socket);

          if (
            !socket.connected ||
            socket.data.chatSessionId !== message.session_id
          ) {
            return;
          }

          const error = accessError(userId, message.session_id);

          if (error) {
            denyChat(socket, error);
            return;
          }

          socket.emit("chat:message", message);
        } catch {
          if (socket.connected) {
            denyChat(socket, "Unable to verify chat access. Reconnect to retry.");
          }
        }
      })
    );
  }

  router.get("/:id/messages", (req, res) => {
    const sessionId = validId(req.params.id);
    const userId = validId(req.session?.userId);

    if (!userId) {
      return res.status(401).json({ error: "Please sign in again." });
    }

    if (!sessionId) {
      return res.status(400).json({ error: "Invalid session ID." });
    }

    const error = accessError(userId, sessionId);

    if (error) {
      return res.status(403).json({ error });
    }

    return res.json({ messages: recentMessages(sessionId) });
  });

  io.use(async (socket, next) => {
    try {
      const userId = await reloadUser(socket);

      if (
        !userId ||
        !db.prepare("SELECT id FROM users WHERE id = ?").get(userId)
      ) {
        return next(new Error("Please sign in again."));
      }

      next();
    } catch {
      next(new Error("Unable to verify your account."));
    }
  });

  io.on("connection", (socket) => {
    socket.data.chatSessionId = null;
    socket.data.sending = false;
    socket.data.lastSentAt = 0;
    socket.data.openAttempt = 0;

    socket.on("chat:open", async (payload, acknowledge) => {
      const reply =
        typeof acknowledge === "function" ? acknowledge : () => {};
      const attempt = ++socket.data.openAttempt;

      socket.data.chatSessionId = null;

      try {
        const sessionId = validId(payload?.sessionId);

        if (!sessionId) {
          return reply({ error: "Invalid session ID." });
        }

        const userId = await reloadUser(socket);

        if (!socket.connected || attempt !== socket.data.openAttempt) {
          return reply({ error: "Chat selection changed. Please try again." });
        }

        const error = accessError(userId, sessionId);

        if (error) {
          return reply({ error });
        }

        const messages = recentMessages(sessionId);
        socket.data.chatSessionId = sessionId;

        reply({ sessionId, messages });
      } catch {
        reply({ error: "Could not open this chat. Please reconnect." });
      }
    });

    socket.on("chat:close", () => {
      socket.data.openAttempt += 1;
      socket.data.chatSessionId = null;
    });

    socket.on("chat:send", async (payload, acknowledge) => {
      const reply =
        typeof acknowledge === "function" ? acknowledge : () => {};

      if (socket.data.sending) {
        return reply({ error: "Please wait for your previous message." });
      }

      const sessionId = validId(payload?.sessionId);
      const content =
        typeof payload?.content === "string" ? payload.content.trim() : "";

      if (!sessionId) {
        return reply({ error: "Invalid session ID." });
      }

      if (!content || content.length > 1000) {
        return reply({
          error: "Messages must contain between 1 and 1000 characters.",
        });
      }

      if (Date.now() - socket.data.lastSentAt < 500) {
        return reply({ error: "Please wait a moment before sending again." });
      }

      socket.data.sending = true;

      let message;

      try {
        const userId = await reloadUser(socket);

        if (
          !socket.connected ||
          socket.data.chatSessionId !== sessionId
        ) {
          reply({ error: "Open this session's chat before sending." });
          return;
        }

        const error = accessError(userId, sessionId);

        if (error) {
          denyChat(socket, error);
          reply({ error });
          return;
        }

        const result = db
          .prepare(`
            INSERT INTO messages (session_id, user_id, content, created_at)
            VALUES (?, ?, ?, ?)
          `)
          .run(sessionId, userId, content, new Date().toISOString());

        message = getMessage(Number(result.lastInsertRowid));
        socket.data.lastSentAt = Date.now();
      } catch {
        reply({ error: "Could not send your message. Please try again." });
        return;
      } finally {
        socket.data.sending = false;
      }

      reply({ message });
      await deliverMessage(message);
    });

    let checkingAccess = false;

    const accessTimer = setInterval(async () => {
      const sessionId = socket.data.chatSessionId;

      if (!sessionId || checkingAccess || !socket.connected) return;

      checkingAccess = true;

      try {
        const userId = await reloadUser(socket);

        if (
          !socket.connected ||
          socket.data.chatSessionId !== sessionId
        ) {
          return;
        }

        const error = accessError(userId, sessionId);

        if (error) denyChat(socket, error);
      } catch {
        if (socket.connected && socket.data.chatSessionId === sessionId) {
          denyChat(socket, "Unable to verify chat access. Reconnect to retry.");
        }
      } finally {
        checkingAccess = false;
      }
    }, 5000);

    accessTimer.unref();

    socket.on("disconnect", () => {
      clearInterval(accessTimer);
      socket.data.openAttempt += 1;
      socket.data.chatSessionId = null;
    });
  });

  return router;
};