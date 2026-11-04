import { useEffect, useState } from "react";
import "./ProfileSkills.css";

async function request(path, method = "GET", body) {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

export default function Profile({ user, onUpdate, onDelete }) {
  const [form, setForm] = useState({
    name: user.name,
    bio: user.bio,
    interests: user.interests,
    skill_level: user.skill_level,
    gaming_username: user.gaming_username,
  });

  const [activities, setActivities] = useState([]);
  const [skills, setSkills] = useState({});
  const [loadingSkills, setLoadingSkills] = useState(true);
  const [skillsError, setSkillsError] = useState("");
  const [skillsMessage, setSkillsMessage] = useState("");
  const [revision, setRevision] = useState(0);

  const [password, setPassword] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function loadSkills() {
      setLoadingSkills(true);
      setSkillsError("");

      try {
        const data = await request("/skills");

        if (!active) return;

        setActivities(data.activities);
        setSkills(
          Object.fromEntries(
            data.skills.map((item) => [item.activity, item.level])
          )
        );
      } catch (err) {
        if (active) setSkillsError(err.message);
      } finally {
        if (active) setLoadingSkills(false);
      }
    }

    loadSkills();

    return () => {
      active = false;
    };
  }, [user.id, revision]);

  function changeField(event) {
    setForm((previous) => ({
      ...previous,
      [event.target.name]: event.target.value,
    }));
  }

  function changeSkill(activity, level) {
    setSkills((previous) => {
      const updated = { ...previous };

      if (level) {
        updated[activity] = level;
      } else {
        delete updated[activity];
      }

      return updated;
    });

    setSkillsMessage("");
  }

  async function saveProfile(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const data = await request("/auth/profile", "PUT", form);

      onUpdate(data.user);

      setForm({
        name: data.user.name,
        bio: data.user.bio,
        interests: data.user.interests,
        skill_level: data.user.skill_level,
        gaming_username: data.user.gaming_username,
      });

      setMessage("Profile saved successfully.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveSkills(event) {
    event.preventDefault();
    setBusy(true);
    setSkillsError("");
    setSkillsMessage("");

    try {
      const payload = {
        skills: Object.entries(skills).map(([activity, level]) => ({
          activity,
          level,
        })),
      };

      const data = await request("/skills", "PUT", payload);

      setSkills(
        Object.fromEntries(
          data.skills.map((item) => [item.activity, item.level])
        )
      );

      setSkillsMessage(data.message);
    } catch (err) {
      setSkillsError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount(event) {
    event.preventDefault();

    if (
      !window.confirm(
        "Permanently delete your account? This cannot be undone."
      )
    ) {
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      await request("/auth/account", "DELETE", { password });
      onDelete();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="profile-section" aria-labelledby="profile-heading">
      <h3 id="profile-heading">Your player profile</h3>

      <form onSubmit={saveProfile}>
        <label>
          Display name
          <input
            name="name"
            value={form.name}
            onChange={changeField}
            minLength={2}
            maxLength={60}
            required
          />
        </label>

        <label>
          About you
          <textarea
            name="bio"
            value={form.bio}
            onChange={changeField}
            placeholder="Tell other players a little about yourself."
            maxLength={300}
            rows={3}
          />
        </label>

        <label>
          Favourite sports and games
          <input
            name="interests"
            value={form.interests}
            onChange={changeField}
            placeholder="Football, Valorant, EA FC..."
            maxLength={150}
          />
        </label>

        <label>
          General experience level
          <select
            name="skill_level"
            value={form.skill_level}
            onChange={changeField}
          >
            <option>Beginner</option>
            <option>Intermediate</option>
            <option>Advanced</option>
          </select>
        </label>

        <label>
          Gaming username
          <input
            name="gaming_username"
            value={form.gaming_username}
            onChange={changeField}
            placeholder="Your in-game name (optional)"
            maxLength={60}
          />
        </label>

        <button
          type="submit"
          className="primary-button"
          disabled={busy}
        >
          {busy ? "Please wait…" : "Save profile"}
        </button>
      </form>

      {message && (
        <p className="success-message" role="status">{message}</p>
      )}

      {error && (
        <p className="error-message" role="alert">{error}</p>
      )}

      <section className="activity-skills-section">
        <h3>Your activity levels</h3>

        <p className="muted">
          Choose a level for each activity you play. You can be
          Advanced at one activity and Beginner at another.
        </p>

        {loadingSkills ? (
          <p role="status">Loading activity levels…</p>
        ) : activities.length > 0 ? (
          <form onSubmit={saveSkills}>
            {["Sports", "Gaming"].map((category) => (
              <fieldset className="skills-fieldset" key={category}>
                <legend>{category}</legend>

                <div className="activity-skills-grid">
                  {activities
                    .filter((item) => item.category === category)
                    .map((item) => (
                      <label key={item.name}>
                        {item.name}

                        <select
                          value={skills[item.name] || ""}
                          onChange={(event) =>
                            changeSkill(item.name, event.target.value)
                          }
                          disabled={busy}
                        >
                          <option value="">Not set</option>
                          <option>Beginner</option>
                          <option>Intermediate</option>
                          <option>Advanced</option>
                        </select>
                      </label>
                    ))}
                </div>
              </fieldset>
            ))}

            <p className="skills-note">
              Leave activities you do not play as “Not set”.
              Save these levels separately from your profile details.
            </p>

            <button
              type="submit"
              className="primary-button"
              disabled={busy}
            >
              {busy ? "Please wait…" : "Save activity levels"}
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="secondary-button"
            onClick={() => setRevision((previous) => previous + 1)}
            disabled={busy}
          >
            Retry loading activities
          </button>
        )}

        {skillsError && (
          <p className="error-message" role="alert">{skillsError}</p>
        )}

        {skillsMessage && (
          <p className="success-message" role="status">
            {skillsMessage}
          </p>
        )}
      </section>

      <div className="delete-section">
        <button
          type="button"
          className="danger-button"
          disabled={busy}
          onClick={() => {
            setShowDelete((previous) => !previous);
            setPassword("");
            setError("");
            setMessage("");
          }}
        >
          {showDelete ? "Cancel deletion" : "Delete my account"}
        </button>

        {showDelete && (
          <form onSubmit={deleteAccount}>
            <p className="muted">
              Deleting your account is permanent. Enter your password
              to confirm.
            </p>

            <label>
              Current password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>

            <button
              type="submit"
              className="danger-button"
              disabled={busy}
            >
              {busy ? "Please wait…" : "Permanently delete account"}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}