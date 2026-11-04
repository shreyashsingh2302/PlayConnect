const express = require("express");

module.exports = function (db) {
  const router = express.Router();

  const activities = [
    { name: "Football", category: "Sports" },
    { name: "Badminton", category: "Sports" },
    { name: "Basketball", category: "Sports" },
    { name: "Cricket", category: "Sports" },
    { name: "Volleyball", category: "Sports" },
    { name: "Tennis", category: "Sports" },
    { name: "Table Tennis", category: "Sports" },
    { name: "Valorant", category: "Gaming" },
    { name: "EA FC", category: "Gaming" },
    { name: "Minecraft", category: "Gaming" },
    { name: "Counter-Strike 2", category: "Gaming" },
    { name: "Fortnite", category: "Gaming" },
    { name: "Rocket League", category: "Gaming" },
    { name: "BGMI", category: "Gaming" },
  ];

  const levels = ["Beginner", "Intermediate", "Advanced"];
  const activityNames = new Set(activities.map((item) => item.name));

  db.exec(`
    CREATE TABLE IF NOT EXISTS player_skills (
      user_id INTEGER NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,
      activity TEXT NOT NULL,
      level TEXT NOT NULL
        CHECK(level IN ('Beginner', 'Intermediate', 'Advanced')),
      PRIMARY KEY (user_id, activity)
    );
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

  function getSkills(userId) {
    return db.prepare(`
      SELECT activity, level
      FROM player_skills
      WHERE user_id = ?
      ORDER BY activity
    `).all(userId);
  }

  router.get("/", (req, res) => {
    res.json({
      activities,
      levels,
      skills: getSkills(req.session.userId),
    });
  });

  router.put("/", (req, res) => {
    const skills = req.body?.skills;

    if (!Array.isArray(skills) || skills.length > activities.length) {
      return res.status(400).json({
        error: "Provide a valid list of activity levels.",
      });
    }

    const seen = new Set();

    for (const skill of skills) {
      if (
        !skill ||
        typeof skill.activity !== "string" ||
        typeof skill.level !== "string" ||
        !activityNames.has(skill.activity) ||
        !levels.includes(skill.level) ||
        seen.has(skill.activity)
      ) {
        return res.status(400).json({
          error: "Each activity must appear once with a valid skill level.",
        });
      }

      seen.add(skill.activity);
    }

    db.exec("BEGIN IMMEDIATE");

    try {
      db.prepare(
        "DELETE FROM player_skills WHERE user_id = ?"
      ).run(req.session.userId);

      const insert = db.prepare(`
        INSERT INTO player_skills (user_id, activity, level)
        VALUES (?, ?, ?)
      `);

      for (const skill of skills) {
        insert.run(
          req.session.userId,
          skill.activity,
          skill.level
        );
      }

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    res.json({
      message: "Activity levels saved.",
      skills: getSkills(req.session.userId),
    });
  });

  return router;
};