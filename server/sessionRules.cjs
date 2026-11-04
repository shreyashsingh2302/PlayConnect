const activities = {
  Sports: [
    "Football",
    "Badminton",
    "Basketball",
    "Cricket",
    "Volleyball",
    "Tennis",
    "Table Tennis",
  ],
  Gaming: [
    "Valorant",
    "EA FC",
    "Minecraft",
    "Counter-Strike 2",
    "Fortnite",
    "Rocket League",
    "BGMI",
  ],
};

const ranks = {
  Beginner: 1,
  Intermediate: 2,
  Advanced: 3,
};

function initialize(db) {
  const columns = db.prepare("PRAGMA table_info(sessions)").all();
  const names = new Set(columns.map((column) => column.name));

  if (!names.has("ends_at")) {
    db.exec("ALTER TABLE sessions ADD COLUMN ends_at TEXT");
  }

  if (!names.has("completed_at")) {
    db.exec("ALTER TABLE sessions ADD COLUMN completed_at TEXT");
  }

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

    DROP TRIGGER IF EXISTS cancel_sessions_before_account_delete;

    CREATE TRIGGER cancel_sessions_before_account_delete
    BEFORE DELETE ON users
    BEGIN
      UPDATE sessions
      SET status = 'Cancelled'
      WHERE host_id = OLD.id
        AND status = 'Open'
        AND completed_at IS NULL;
    END;

    CREATE TRIGGER IF NOT EXISTS notify_session_end_changed
    AFTER UPDATE OF ends_at ON sessions
    WHEN OLD.ends_at IS NOT NEW.ends_at
      AND NEW.status = 'Open'
      AND NEW.completed_at IS NULL
    BEGIN
      INSERT INTO notifications (user_id, session_id, message)
      SELECT
        participants.user_id,
        NEW.id,
        'The end time for "' || NEW.title || '" has changed.'
      FROM participants
      WHERE participants.session_id = NEW.id
        AND participants.status IN ('Accepted', 'Pending');
    END;

    CREATE TRIGGER IF NOT EXISTS notify_session_completed
    AFTER UPDATE OF completed_at ON sessions
    WHEN OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL
    BEGIN
      INSERT INTO notifications (user_id, session_id, message)
      SELECT
        participants.user_id,
        NEW.id,
        'The session "' || NEW.title || '" has been marked completed.'
      FROM participants
      WHERE participants.session_id = NEW.id
        AND participants.status = 'Accepted';
    END;
  `);
}

function formatSession(item) {
  return {
    ...item,
    status: item.completed_at ? "Completed" : item.status,
  };
}

function isOpen(item) {
  return item.status === "Open" && !item.completed_at;
}

function upcoming(item) {
  return isOpen(item) && Date.parse(item.starts_at) > Date.now();
}

function conflict(db, userId, startsAt, endsAt, excludedId = 0) {
  return db.prepare(`
    SELECT s.id, s.title, s.starts_at, s.ends_at
    FROM sessions s
    WHERE s.id != ?
      AND s.status = 'Open'
      AND s.completed_at IS NULL
      AND s.starts_at < ?
      AND (s.ends_at IS NULL OR s.ends_at > ?)
      AND (
        s.host_id = ?
        OR EXISTS (
          SELECT 1
          FROM participants p
          WHERE p.session_id = s.id
            AND p.user_id = ?
            AND p.status = 'Accepted'
        )
      )
    ORDER BY s.starts_at
    LIMIT 1
  `).get(excludedId, endsAt, startsAt, userId, userId);
}

function eligibility(db, userId, item) {
  if (!upcoming(item)) {
    return {
      eligible: false,
      reason: "This session is not open for new requests.",
    };
  }

  if (!item.ends_at) {
    return {
      eligible: false,
      reason: "The host must add an end time before players can apply.",
    };
  }

  const skill = db.prepare(`
    SELECT level FROM player_skills
    WHERE user_id = ? AND activity = ?
  `).get(userId, item.activity);

  if (!skill) {
    return {
      eligible: false,
      reason: `Set your ${item.activity} skill level in My profile first.`,
    };
  }

  if (
    item.skill_level !== "Any level" &&
    (ranks[skill.level] ?? 0) < (ranks[item.skill_level] ?? Infinity)
  ) {
    return {
      eligible: false,
      reason:
        `${item.activity} requires ${item.skill_level} level or higher. ` +
        `Your level is ${skill.level}.`,
    };
  }

  const overlapping = conflict(
    db,
    userId,
    item.starts_at,
    item.ends_at,
    item.id
  );

  if (overlapping) {
    return {
      eligible: false,
      reason: `This overlaps with "${overlapping.title}", which you already host or have joined.`,
    };
  }

  return {
    eligible: true,
    reason: `Your ${item.activity} level meets the requirement.`,
  };
}

module.exports = {
  activities,
  initialize,
  formatSession,
  isOpen,
  upcoming,
  conflict,
  eligibility,
};