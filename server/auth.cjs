const express = require("express");
const bcrypt = require("bcryptjs");

module.exports = function (db) {
  const router = express.Router();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '',
      interests TEXT NOT NULL DEFAULT '',
      skill_level TEXT NOT NULL DEFAULT 'Beginner',
      gaming_username TEXT NOT NULL DEFAULT ''
    )
  `);

  function getUser(id) {
    return db.prepare(`
      SELECT id, name, email, bio, interests,
             skill_level, gaming_username
      FROM users WHERE id = ?
    `).get(id);
  }

  function signIn(req, res, next, userId) {
    req.session.regenerate((error) => {
      if (error) return next(error);

      req.session.userId = userId;

      req.session.save((error) => {
        if (error) return next(error);
        res.json({ user: getUser(userId) });
      });
    });
  }

  router.post("/register", async (req, res, next) => {
    try {
      const { name, email, password } = req.body ?? {};

      if (
        typeof name !== "string" ||
        typeof email !== "string" ||
        typeof password !== "string"
      ) {
        return res.status(400).json({
          error: "Name, email and password are required.",
        });
      }

      const cleanName = name.trim();
      const cleanEmail = email.trim().toLowerCase();

      if (cleanName.length < 2 || cleanName.length > 60) {
        return res.status(400).json({
          error: "Name must contain 2–60 characters.",
        });
      }

      if (
        cleanEmail.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)
      ) {
        return res.status(400).json({
          error: "Enter a valid email address.",
        });
      }

      if (
        password.length < 8 ||
        Buffer.byteLength(password, "utf8") > 72
      ) {
        return res.status(400).json({
          error: "Password must be at least 8 characters and at most 72 bytes.",
        });
      }

      const passwordHash = await bcrypt.hash(password, 12);

      let result;

      try {
        result = db.prepare(`
          INSERT INTO users (name, email, password_hash)
          VALUES (?, ?, ?)
        `).run(cleanName, cleanEmail, passwordHash);
      } catch (error) {
        const existing = db.prepare(
          "SELECT id FROM users WHERE email = ?"
        ).get(cleanEmail);

        if (existing) {
          return res.status(409).json({
            error: "An account with this email already exists.",
          });
        }

        throw error;
      }

      signIn(req, res, next, Number(result.lastInsertInsertRowid ?? result.lastInsertRowid));
    } catch (error) {
      next(error);
    }
  });

  router.post("/login", async (req, res, next) => {
    try {
      const { email, password } = req.body ?? {};

      if (
        typeof email !== "string" ||
        typeof password !== "string" ||
        email.length > 254 ||
        Buffer.byteLength(password, "utf8") > 72
      ) {
        return res.status(400).json({
          error: "Enter a valid email and password.",
        });
      }

      const user = db.prepare(
        "SELECT * FROM users WHERE email = ?"
      ).get(email.trim().toLowerCase());

      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({
          error: "Incorrect email or password.",
        });
      }

      signIn(req, res, next, user.id);
    } catch (error) {
      next(error);
    }
  });

  router.get("/me", (req, res) => {
    const user = req.session.userId
      ? getUser(req.session.userId)
      : null;

    res.json({ user: user ?? null });
  });

  router.post("/logout", (req, res, next) => {
    req.session.destroy((error) => {
      if (error) return next(error);

      res.clearCookie("playconnect.sid");
      res.json({ message: "Logged out successfully." });
    });
  });

  // All routes below this point require a valid login.
  router.use((req, res, next) => {
    if (!req.session.userId || !getUser(req.session.userId)) {
      return res.status(401).json({
        error: "Please sign in again.",
      });
    }

    next();
  });

  router.put("/profile", (req, res) => {
    const fields = [
      "name",
      "bio",
      "interests",
      "skill_level",
      "gaming_username",
    ];

    const body = req.body ?? {};

    if (fields.some((field) => typeof body[field] !== "string")) {
      return res.status(400).json({
        error: "Please complete the profile fields correctly.",
      });
    }

    const name = body.name.trim();
    const bio = body.bio.trim();
    const interests = body.interests.trim();
    const skill = body.skill_level;
    const username = body.gaming_username.trim();

    if (
      name.length < 2 ||
      name.length > 60 ||
      bio.length > 300 ||
      interests.length > 150 ||
      username.length > 60 ||
      !["Beginner", "Intermediate", "Advanced"].includes(skill)
    ) {
      return res.status(400).json({
        error: "Check the field lengths and select a valid skill level.",
      });
    }

    db.prepare(`
      UPDATE users
      SET name = ?, bio = ?, interests = ?,
          skill_level = ?, gaming_username = ?
      WHERE id = ?
    `).run(
      name,
      bio,
      interests,
      skill,
      username,
      req.session.userId
    );

    res.json({ user: getUser(req.session.userId) });
  });

  router.delete("/account", async (req, res, next) => {
    try {
      const { password } = req.body ?? {};

      if (
        typeof password !== "string" ||
        !password ||
        Buffer.byteLength(password, "utf8") > 72
      ) {
        return res.status(400).json({
          error: "Enter your current password.",
        });
      }

      const userId = req.session.userId;
      const user = db.prepare(
        "SELECT * FROM users WHERE id = ?"
      ).get(userId);

      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(403).json({
          error: "Incorrect password. Account was not deleted.",
        });
      }

      db.prepare("DELETE FROM users WHERE id = ?").run(userId);

      req.session.destroy((error) => {
        if (error) return next(error);

        res.clearCookie("playconnect.sid");
        res.json({ message: "Your account has been deleted." });
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
};