const express = require("express");
const rules = require("./sessionRules.cjs");

module.exports = function (db) {
  const router = express.Router();

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('Sports', 'Gaming')),
      activity TEXT NOT NULL,
      skill_level TEXT NOT NULL,
      location TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      starts_at TEXT NOT NULL,
      capacity INTEGER NOT NULL CHECK(capacity BETWEEN 2 AND 100),
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Open'
        CHECK(status IN ('Open', 'Cancelled')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

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

  rules.initialize(db);

  router.use((req, res, next) => {
    const user = req.session.userId
      ? db.prepare("SELECT id FROM users WHERE id = ?")
          .get(req.session.userId)
      : null;

    if (!user) {
      return res.status(401).json({
        error: "Please sign in again.",
      });
    }

    next();
  });

  function getSession(id) {
    return db.prepare(`
      SELECT s.*, COALESCE(u.name, 'Deleted account') AS host_name
      FROM sessions s
      LEFT JOIN users u ON u.id = s.host_id
      WHERE s.id = ?
    `).get(id);
  }

  function validate(body, existing = null) {
    const fields = [
      "title",
      "category",
      "activity",
      "skill_level",
      "location",
      "platform",
      "region",
      "starts_at",
      "ends_at",
      "description",
    ];

    if (
      !body ||
      fields.some((field) => typeof body[field] !== "string")
    ) {
      return { error: "Complete all session fields, including the end time." };
    }

    const data = Object.fromEntries(
      fields.map((field) => [field, body[field].trim()])
    );

    if (
      !["number", "string"].includes(typeof body.capacity) ||
      String(body.capacity).trim() === ""
    ) {
      return { error: "Enter a valid player limit." };
    }

    data.capacity = Number(body.capacity);

    if (data.title.length < 3 || data.title.length > 100) {
      return { error: "Title must contain 3–100 characters." };
    }

    if (!rules.activities[data.category]?.includes(data.activity)) {
      return { error: "Choose a valid activity for the selected category." };
    }

    if (
      !["Any level", "Beginner", "Intermediate", "Advanced"]
        .includes(data.skill_level)
    ) {
      return { error: "Choose a valid minimum skill level." };
    }

    if (
      !Number.isInteger(data.capacity) ||
      data.capacity < 2 ||
      data.capacity > 100
    ) {
      return { error: "Player limit must be a whole number from 2 to 100." };
    }

    if (
      data.location.length > 150 ||
      data.platform.length > 60 ||
      data.region.length > 60 ||
      data.description.length > 1000
    ) {
      return { error: "One or more fields exceed the permitted length." };
    }

    if (data.category === "Sports") {
      if (data.location.length < 3) {
        return { error: "Enter the venue and locality." };
      }

      data.platform = "";
      data.region = "";
    } else {
      if (!data.platform || !data.region) {
        return { error: "Enter the gaming platform and server region." };
      }

      data.location = "";
    }

    const start = Date.parse(data.starts_at);
    const end = Date.parse(data.ends_at);

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return { error: "The end time must be later than the start time." };
    }

    const repairingOldSession =
      existing &&
      !existing.ends_at &&
      start === Date.parse(existing.starts_at);

    if (start <= Date.now() && !repairingOldSession) {
      return { error: "Choose a start time in the future." };
    }

    data.starts_at = new Date(start).toISOString();
    data.ends_at = new Date(end).toISOString();

    return { data };
  }

  function values(data) {
    return [
      data.title,
      data.category,
      data.activity,
      data.skill_level,
      data.location,
      data.platform,
      data.region,
      data.starts_at,
      data.ends_at,
      data.capacity,
      data.description,
    ];
  }

  function scheduleError(item, data, hostId) {
    const userIds = new Set([hostId]);

    if (item) {
      const players = db.prepare(`
        SELECT user_id FROM participants
        WHERE session_id = ? AND status = 'Accepted'
      `).all(item.id);

      for (const player of players) {
        userIds.add(player.user_id);
      }
    }

    for (const userId of userIds) {
      if (!userId) continue;

      const overlapping = rules.conflict(
        db,
        userId,
        data.starts_at,
        data.ends_at,
        item?.id ?? 0
      );

      if (overlapping) {
        return userId === hostId
          ? `You already have a conflicting session: "${overlapping.title}".`
          : "The proposed schedule overlaps with another commitment of an accepted player.";
      }
    }

    return null;
  }

  router.get("/", (req, res) => {
    let sessions = db.prepare(`
      SELECT s.*, COALESCE(u.name, 'Deleted account') AS host_name
      FROM sessions s
      LEFT JOIN users u ON u.id = s.host_id
      ORDER BY s.starts_at ASC
    `).all();

    if (req.query.mine === "true") {
      sessions = sessions.filter(
        (item) => item.host_id === req.session.userId
      );
    } else {
      sessions = sessions.filter(rules.upcoming);
    }

    const q = typeof req.query.q === "string"
      ? req.query.q.trim().toLowerCase()
      : "";

    if (req.query.category) {
      sessions = sessions.filter(
        (item) => item.category === req.query.category
      );
    }

    if (req.query.skill) {
      sessions = sessions.filter(
        (item) => item.skill_level === req.query.skill
      );
    }

    if (q) {
      sessions = sessions.filter((item) =>
        [
          item.title,
          item.activity,
          item.location,
          item.platform,
          item.region,
          item.host_name,
        ].some((value) => value.toLowerCase().includes(q))
      );
    }

    res.json({ sessions: sessions.map(rules.formatSession) });
  });

  router.get("/history", (req, res) => {
    const sessions = db.prepare(`
      SELECT
        s.*,
        COALESCE(u.name, 'Deleted account') AS host_name,
        CASE WHEN s.host_id = ? THEN 'Host' ELSE 'Player' END AS role
      FROM sessions s
      LEFT JOIN users u ON u.id = s.host_id
      WHERE s.completed_at IS NOT NULL
        AND (
          s.host_id = ?
          OR EXISTS (
            SELECT 1 FROM participants p
            WHERE p.session_id = s.id
              AND p.user_id = ?
              AND p.status = 'Accepted'
          )
        )
      ORDER BY s.completed_at DESC
    `).all(
      req.session.userId,
      req.session.userId,
      req.session.userId
    );

    res.json({ sessions: sessions.map(rules.formatSession) });
  });

  router.post("/", (req, res) => {
    const result = validate(req.body);

    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    const error = scheduleError(null, result.data, req.session.userId);

    if (error) {
      return res.status(409).json({ error });
    }

    const inserted = db.prepare(`
      INSERT INTO sessions (
        host_id, title, category, activity, skill_level,
        location, platform, region, starts_at, ends_at,
        capacity, description
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.session.userId, ...values(result.data));

    res.status(201).json({
      session: rules.formatSession(
        getSession(Number(inserted.lastInsertRowid))
      ),
    });
  });

  router.param("id", (req, res, next, value) => {
    const id = Number(value);

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid session ID." });
    }

    const item = getSession(id);

    if (!item) {
      return res.status(404).json({ error: "Session not found." });
    }

    req.playSession = item;
    next();
  });

  router.get("/:id", (req, res) => {
    res.json({ session: rules.formatSession(req.playSession) });
  });

  router.put("/:id", (req, res) => {
    const item = req.playSession;

    if (item.host_id !== req.session.userId) {
      return res.status(403).json({
        error: "Only the host can edit this session.",
      });
    }

    const repairingOldSession = !item.ends_at;

    if (
      !rules.isOpen(item) ||
      (!repairingOldSession && !rules.upcoming(item))
    ) {
      return res.status(400).json({
        error: "This session can no longer be edited.",
      });
    }

    const result = validate(req.body, item);

    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    const occupied = db.prepare(`
      SELECT COUNT(*) + 1 AS total
      FROM participants
      WHERE session_id = ? AND status = 'Accepted'
    `).get(item.id).total;

    if (result.data.capacity < occupied) {
      return res.status(400).json({
        error: `Capacity cannot be below ${occupied} existing players.`,
      });
    }

    const scheduleChanged =
      item.starts_at !== result.data.starts_at ||
      item.ends_at !== result.data.ends_at;

    if (scheduleChanged) {
      const error = scheduleError(item, result.data, item.host_id);

      if (error) {
        return res.status(409).json({ error });
      }
    }

    db.prepare(`
      UPDATE sessions
      SET title = ?, category = ?, activity = ?, skill_level = ?,
          location = ?, platform = ?, region = ?, starts_at = ?,
          ends_at = ?, capacity = ?, description = ?
      WHERE id = ?
    `).run(...values(result.data), item.id);

    res.json({
      session: rules.formatSession(getSession(item.id)),
    });
  });

  router.post("/:id/cancel", (req, res) => {
    const item = req.playSession;

    if (item.host_id !== req.session.userId) {
      return res.status(403).json({
        error: "Only the host can cancel this session.",
      });
    }

    if (!rules.isOpen(item)) {
      return res.status(400).json({
        error: "This session is already cancelled or completed.",
      });
    }

    db.prepare(`
      UPDATE sessions SET status = 'Cancelled' WHERE id = ?
    `).run(item.id);

    res.json({
      message: "Session cancelled.",
      session: rules.formatSession(getSession(item.id)),
    });
  });

  router.post("/:id/complete", (req, res) => {
    const item = req.playSession;

    if (item.host_id !== req.session.userId) {
      return res.status(403).json({
        error: "Only the host can complete this session.",
      });
    }

    if (!rules.isOpen(item)) {
      return res.status(400).json({
        error: "This session is already cancelled or completed.",
      });
    }

    if (!item.ends_at) {
      return res.status(400).json({
        error: "Add the session end time before marking it completed.",
      });
    }

    if (Date.parse(item.ends_at) > Date.now()) {
      return res.status(400).json({
        error: "You can mark this session completed after its end time.",
      });
    }

    db.prepare(`
      UPDATE sessions SET completed_at = ? WHERE id = ?
    `).run(new Date().toISOString(), item.id);

    res.json({
      message: "Session completed and added to your history.",
      session: rules.formatSession(getSession(item.id)),
    });
  });

  return router;
};