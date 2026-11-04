const express = require("express");

module.exports = function (db) {
  const router = express.Router();

  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,
      session_id INTEGER
        REFERENCES sessions(id) ON DELETE SET NULL,
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0
        CHECK(is_read IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT
        (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS notifications_user_index
    ON notifications(user_id, is_read, id);

    CREATE TRIGGER IF NOT EXISTS notify_join_request
    AFTER INSERT ON participants
    WHEN NEW.status = 'Pending'
    BEGIN
      INSERT INTO notifications (user_id, session_id, message)
      SELECT
        sessions.host_id,
        sessions.id,
        users.name || ' requested to join "' || sessions.title || '".'
      FROM sessions
      JOIN users ON users.id = NEW.user_id
      WHERE sessions.id = NEW.session_id
        AND sessions.host_id IS NOT NULL;
    END;

    CREATE TRIGGER IF NOT EXISTS notify_request_decision
    AFTER UPDATE OF status ON participants
    WHEN OLD.status != NEW.status
      AND NEW.status IN ('Accepted', 'Rejected')
    BEGIN
      INSERT INTO notifications (user_id, session_id, message)
      SELECT
        NEW.user_id,
        sessions.id,
        'Your request to join "' || sessions.title || '" was ' ||
        CASE NEW.status
          WHEN 'Accepted' THEN 'accepted.'
          ELSE 'rejected.'
        END
      FROM sessions
      WHERE sessions.id = NEW.session_id;
    END;

    CREATE TRIGGER IF NOT EXISTS notify_session_cancelled
    AFTER UPDATE OF status ON sessions
    WHEN OLD.status != NEW.status AND NEW.status = 'Cancelled'
    BEGIN
      INSERT INTO notifications (user_id, session_id, message)
      SELECT
        participants.user_id,
        NEW.id,
        'The session "' || NEW.title || '" has been cancelled.'
      FROM participants
      WHERE participants.session_id = NEW.id
        AND participants.status IN ('Accepted', 'Pending');
    END;

    CREATE TRIGGER IF NOT EXISTS notify_session_changed
    AFTER UPDATE OF
      title, category, activity, skill_level, location,
      platform, region, starts_at, capacity, description
    ON sessions
    WHEN NEW.status = 'Open' AND (
      OLD.title IS NOT NEW.title OR
      OLD.category IS NOT NEW.category OR
      OLD.activity IS NOT NEW.activity OR
      OLD.skill_level IS NOT NEW.skill_level OR
      OLD.location IS NOT NEW.location OR
      OLD.platform IS NOT NEW.platform OR
      OLD.region IS NOT NEW.region OR
      OLD.starts_at IS NOT NEW.starts_at OR
      OLD.capacity IS NOT NEW.capacity OR
      OLD.description IS NOT NEW.description
    )
    BEGIN
      INSERT INTO notifications (user_id, session_id, message)
      SELECT
        participants.user_id,
        NEW.id,
        'Details for "' || NEW.title || '" have changed. Check the session.'
      FROM participants
      WHERE participants.session_id = NEW.id
        AND participants.status IN ('Accepted', 'Pending');
    END;
  `);

  router.use((req, res, next) => {
    const user = req.session.userId
      ? db.prepare(
          "SELECT id FROM users WHERE id = ?"
        ).get(req.session.userId)
      : null;

    if (!user) {
      return res.status(401).json({
        error: "Please sign in again.",
      });
    }

    next();
  });

  router.get("/", (req, res) => {
    const userId = req.session.userId;
    const now = new Date().toISOString();

    const hosted = db.prepare(`
      SELECT COUNT(*) AS total
      FROM sessions
      WHERE host_id = ?
        AND status = 'Open'
        AND starts_at > ?
    `).get(userId, now).total;

    const joined = db.prepare(`
      SELECT COUNT(*) AS total
      FROM participants
      JOIN sessions ON sessions.id = participants.session_id
      WHERE participants.user_id = ?
        AND participants.status = 'Accepted'
        AND sessions.status = 'Open'
        AND sessions.starts_at > ?
    `).get(userId, now).total;

    const pendingRequests = db.prepare(`
      SELECT COUNT(*) AS total
      FROM participants
      JOIN sessions ON sessions.id = participants.session_id
      WHERE participants.user_id = ?
        AND participants.status = 'Pending'
        AND sessions.status = 'Open'
        AND sessions.starts_at > ?
    `).get(userId, now).total;

    const requestsToReview = db.prepare(`
      SELECT COUNT(*) AS total
      FROM participants
      JOIN sessions ON sessions.id = participants.session_id
      WHERE sessions.host_id = ?
        AND participants.status = 'Pending'
        AND sessions.status = 'Open'
        AND sessions.starts_at > ?
    `).get(userId, now).total;

    const unread = db.prepare(`
      SELECT COUNT(*) AS total
      FROM notifications
      WHERE user_id = ? AND is_read = 0
    `).get(userId).total;

    const upcoming = db.prepare(`
      SELECT
        sessions.*,
        COALESCE(users.name, 'Deleted account') AS host_name,
        CASE
          WHEN sessions.host_id = ? THEN 'Host'
          ELSE 'Player'
        END AS role
      FROM sessions
      LEFT JOIN users ON users.id = sessions.host_id
      WHERE sessions.status = 'Open'
        AND sessions.starts_at > ?
        AND (
          sessions.host_id = ?
          OR EXISTS (
            SELECT 1
            FROM participants
            WHERE participants.session_id = sessions.id
              AND participants.user_id = ?
              AND participants.status = 'Accepted'
          )
        )
      ORDER BY sessions.starts_at ASC
      LIMIT 10
    `).all(userId, now, userId, userId);

    const notifications = db.prepare(`
      SELECT id, session_id, message, is_read, created_at
      FROM notifications
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 50
    `).all(userId);

    res.json({
      stats: {
        hosted,
        joined,
        pendingRequests,
        requestsToReview,
        unread,
      },
      upcoming,
      notifications,
    });
  });

  router.post("/notifications/read-all", (req, res) => {
    db.prepare(`
      UPDATE notifications
      SET is_read = 1
      WHERE user_id = ? AND is_read = 0
    `).run(req.session.userId);

    res.json({
      message: "All notifications marked as read.",
    });
  });

  router.post("/notifications/:id/read", (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({
        error: "Invalid notification ID.",
      });
    }

    const result = db.prepare(`
      UPDATE notifications
      SET is_read = 1
      WHERE id = ? AND user_id = ?
    `).run(id, req.session.userId);

    if (Number(result.changes) === 0) {
      return res.status(404).json({
        error: "Notification not found.",
      });
    }

    res.json({
      message: "Notification marked as read.",
    });
  });

  return router;
};