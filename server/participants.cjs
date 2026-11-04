const express = require("express");
const rules = require("./sessionRules.cjs");

module.exports = function (db) {
  const router = express.Router();

  const cutoffMinutes = 30;
  const cutoffMs = cutoffMinutes * 60 * 1000;

  db.exec(`
    CREATE TABLE IF NOT EXISTS participants (
      session_id INTEGER NOT NULL
        REFERENCES sessions(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'Pending'
        CHECK(status IN ('Pending', 'Accepted', 'Rejected')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (session_id, user_id)
    );
  `);

  router.use((req, res, next) => {
    const user = req.session.userId
      ? db.prepare("SELECT id, name FROM users WHERE id = ?")
          .get(req.session.userId)
      : null;

    if (!user) {
      return res.status(401).json({
        error: "Please sign in again.",
      });
    }

    req.currentPlayer = user;
    next();
  });

  function membership(sessionId, userId) {
    return db.prepare(`
      SELECT * FROM participants
      WHERE session_id = ? AND user_id = ?
    `).get(sessionId, userId);
  }

  function acceptedCount(sessionId) {
    return db.prepare(`
      SELECT COUNT(*) AS total
      FROM participants
      WHERE session_id = ? AND status = 'Accepted'
    `).get(sessionId).total;
  }

  function leaveError(item, member) {
    if (item.completed_at) {
      return "Completed sessions remain in your history.";
    }

    if (
      member?.status !== "Accepted" ||
      item.status === "Cancelled"
    ) {
      return null;
    }

    const remaining = Date.parse(item.starts_at) - Date.now();

    if (remaining <= 0) {
      return "You cannot leave after the scheduled start time.";
    }

    if (remaining <= cutoffMs) {
      return "You cannot leave during the final 30 minutes before the session starts.";
    }

    return null;
  }

  router.get("/joined", (req, res) => {
    const sessions = db.prepare(`
      SELECT
        s.*,
        COALESCE(u.name, 'Deleted account') AS host_name,
        p.status AS membership_status
      FROM participants p
      JOIN sessions s ON s.id = p.session_id
      LEFT JOIN users u ON u.id = s.host_id
      WHERE p.user_id = ?
      ORDER BY s.starts_at ASC
    `).all(req.session.userId);

    res.json({
      sessions: sessions.map(rules.formatSession),
    });
  });

  router.param("id", (req, res, next, value) => {
    const id = Number(value);

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({
        error: "Invalid session ID.",
      });
    }

    const item = db.prepare(
      "SELECT * FROM sessions WHERE id = ?"
    ).get(id);

    if (!item) {
      return res.status(404).json({
        error: "Session not found.",
      });
    }

    req.participantSession = item;
    next();
  });

  router.get("/:id/participants", (req, res) => {
    const item = req.participantSession;
    const isHost = item.host_id === req.session.userId;
    const own = membership(item.id, req.session.userId);

    const members = db.prepare(`
      SELECT
        p.user_id,
        p.status,
        p.created_at,
        u.name,
        COALESCE(ps.level, 'Not set') AS skill_level
      FROM participants p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN player_skills ps
        ON ps.user_id = p.user_id AND ps.activity = ?
      WHERE p.session_id = ?
      ORDER BY p.created_at
    `).all(item.activity, item.id);

    const host = item.host_id
      ? db.prepare("SELECT id, name FROM users WHERE id = ?")
          .get(item.host_id)
      : null;

    const occupied = acceptedCount(item.id) + (host ? 1 : 0);
    const available = Math.max(0, item.capacity - occupied);
    const blockedLeave = leaveError(item, own);

    let application = rules.eligibility(
      db,
      req.session.userId,
      item
    );

    if (isHost) {
      application = {
        eligible: false,
        reason: "You are hosting this session.",
      };
    } else if (own) {
      application = {
        eligible: false,
        reason:
          own.status === "Accepted"
            ? "You are already on this team."
            : own.status === "Pending"
              ? "Your request is awaiting host approval."
              : "Withdraw your rejected request before applying again.",
      };
    } else if (application.eligible && available === 0) {
      application = {
        eligible: false,
        reason: "This session is full.",
      };
    }

    res.json({
      host: host ?? null,
      members: isHost
        ? members
        : members.filter((member) => member.status === "Accepted"),
      my_status: isHost ? "Host" : own?.status ?? "Not joined",
      occupied,
      capacity: item.capacity,
      available,
      withdrawal_cutoff_minutes: cutoffMinutes,
      can_leave: !isHost && Boolean(own) && !blockedLeave,
      leave_block_reason: blockedLeave,
      can_apply: application.eligible,
      application_reason: application.reason,
    });
  });

  router.post("/:id/join", (req, res) => {
    const item = req.participantSession;
    const userId = req.session.userId;

    if (item.host_id === userId) {
      return res.status(400).json({
        error: "You are already hosting this session.",
      });
    }

    if (membership(item.id, userId)) {
      return res.status(409).json({
        error: "You already have a request or membership for this session.",
      });
    }

    const application = rules.eligibility(db, userId, item);

    if (!application.eligible) {
      return res.status(403).json({
        error: application.reason,
      });
    }

    if (acceptedCount(item.id) + 1 >= item.capacity) {
      return res.status(409).json({
        error: "This session is full.",
      });
    }

    db.prepare(`
      INSERT INTO participants (session_id, user_id, status)
      VALUES (?, ?, 'Pending')
    `).run(item.id, userId);

    res.status(201).json({
      message: "Join request sent. Waiting for host approval.",
    });
  });

  router.post("/:id/leave", (req, res) => {
    const item = req.participantSession;
    const userId = req.session.userId;

    if (item.host_id === userId) {
      return res.status(400).json({
        error: "Hosts cannot leave their session. Cancel it instead.",
      });
    }

    const own = membership(item.id, userId);

    if (!own) {
      return res.status(404).json({
        error: "No request or membership was found.",
      });
    }

    const blockedLeave = leaveError(item, own);

    if (blockedLeave) {
      return res.status(403).json({ error: blockedLeave });
    }

    db.exec("BEGIN IMMEDIATE");

    try {
      db.prepare(`
        DELETE FROM participants
        WHERE session_id = ? AND user_id = ?
      `).run(item.id, userId);

      if (
        item.host_id &&
        ["Accepted", "Pending"].includes(own.status)
      ) {
        const action = own.status === "Accepted"
          ? "left"
          : "withdrew their request for";

        db.prepare(`
          INSERT INTO notifications (user_id, session_id, message)
          VALUES (?, ?, ?)
        `).run(
          item.host_id,
          item.id,
          `${req.currentPlayer.name} ${action} "${item.title}".`
        );
      }

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    res.json({
      message: own.status === "Accepted"
        ? "You have left the session."
        : "Your request has been withdrawn.",
    });
  });

  router.post("/:id/requests/:userId", (req, res) => {
    const item = req.participantSession;

    if (item.host_id !== req.session.userId) {
      return res.status(403).json({
        error: "Only the host can manage requests.",
      });
    }

    if (!rules.upcoming(item)) {
      return res.status(400).json({
        error: "Requests are closed for this session.",
      });
    }

    const userId = Number(req.params.userId);
    const status = req.body?.status;

    if (
      !Number.isSafeInteger(userId) ||
      userId < 1 ||
      !["Accepted", "Rejected"].includes(status)
    ) {
      return res.status(400).json({
        error: "Choose a valid player and decision.",
      });
    }

    db.exec("BEGIN IMMEDIATE");

    try {
      const own = membership(item.id, userId);

      if (!own || own.status !== "Pending") {
        db.exec("ROLLBACK");
        return res.status(409).json({
          error: "This request is no longer pending.",
        });
      }

      if (status === "Accepted") {
        if (!item.ends_at) {
          db.exec("ROLLBACK");
          return res.status(400).json({
            error: "Add an end time before accepting players.",
          });
        }

        if (acceptedCount(item.id) + 1 >= item.capacity) {
          db.exec("ROLLBACK");
          return res.status(409).json({
            error: "This session is full.",
          });
        }

        const overlapping = rules.conflict(
          db,
          userId,
          item.starts_at,
          item.ends_at,
          item.id
        );

        if (overlapping) {
          db.exec("ROLLBACK");
          return res.status(409).json({
            error: "This player now has another session at the same time and cannot be accepted.",
          });
        }
      }

      db.prepare(`
        UPDATE participants SET status = ?
        WHERE session_id = ? AND user_id = ?
      `).run(status, item.id, userId);

      db.exec("COMMIT");

      res.json({
        message: status === "Accepted"
          ? "Player accepted."
          : "Request rejected.",
      });
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });

  return router;
};