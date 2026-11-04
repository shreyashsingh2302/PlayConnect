import { useEffect, useState } from "react";
import "./Sessions.css";
import "./Participation.css";

const emptyForm = {
  title: "",
  category: "Sports",
  activity: "",
  skill_level: "Any level",
  location: "",
  platform: "",
  region: "",
  starts_at: "",
  ends_at: "",
  capacity: 10,
  description: "",
};

const levels = ["Any level", "Beginner", "Intermediate", "Advanced"];

async function sessionApi(path = "", method = "GET", body) {
  const response = await fetch(`/api/sessions${path}`, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || data.message || "Something went wrong.");
  }

  return data;
}

function localDateTime(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  const pad = (number) => String(number).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function displayDate(value) {
  if (!value) return "Not set";

  return new Date(value).toLocaleString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Field({
  label,
  name,
  value,
  onChange,
  options,
  multiline,
  full,
  ...props
}) {
  return (
    <label className={`field${full ? " full-width" : ""}`}>
      <span>{label}</span>
      {options ? (
        <select name={name} value={value} onChange={onChange} {...props}>
          {options.map((option) => (
            <option
              key={typeof option === "string" ? option : option.value}
              value={typeof option === "string" ? option : option.value}
            >
              {typeof option === "string" ? option : option.label}
            </option>
          ))}
        </select>
      ) : multiline ? (
        <textarea
          name={name}
          value={value}
          onChange={onChange}
          rows={4}
          {...props}
        />
      ) : (
        <input name={name} value={value} onChange={onChange} {...props} />
      )}
    </label>
  );
}

export default function Sessions({ user }) {
  const [tab, setTab] = useState("discover");
  const [sessions, setSessions] = useState([]);
  const [activities, setActivities] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [skill, setSkill] = useState("");
  const [date, setDate] = useState("");
  const [availableOnly, setAvailableOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadActivities() {
      try {
        const response = await fetch("/api/skills", {
          credentials: "same-origin",
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Could not load activities.");
        }

        if (active) setActivities(data.activities || []);
      } catch (err) {
        if (active) setError(err.message);
      }
    }

    loadActivities();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (tab === "create") return;

    let active = true;

    async function loadSessions() {
      setLoading(true);

      try {
        const path =
          tab === "mine"
            ? "?mine=true"
            : tab === "joined"
              ? "/joined"
              : tab === "history"
                ? "/history"
                : "";

        const data = await sessionApi(path);

        const enriched = await Promise.all(
          (data.sessions || []).map(async (item) => {
            const participation = await sessionApi(
              `/${item.id}/participants`
            );

            return { ...item, participation };
          })
        );

        if (active) setSessions(enriched);
      } catch (err) {
        if (active) {
          setSessions([]);
          setError(err.message);
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadSessions();

    return () => {
      active = false;
    };
  }, [tab, revision]);

  function changeTab(next) {
    setTab(next);
    setError("");
    setMessage("");
    setExpandedId(null);
    setSearch("");
    setCategory("");
    setSkill("");
    setDate("");
    setAvailableOnly(false);

    if (next === "create") {
      setEditing(null);
      setForm({ ...emptyForm });
    }
  }

  function changeField(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
      ...(name === "category" ? { activity: "" } : {}),
    }));
  }

  function editSession(item) {
    setEditing(item);
    setForm({
      title: item.title || "",
      category: item.category || "Sports",
      activity: item.activity || "",
      skill_level: item.skill_level || "Any level",
      location: item.location || "",
      platform: item.platform || "",
      region: item.region || "",
      starts_at: localDateTime(item.starts_at),
      ends_at: localDateTime(item.ends_at),
      capacity: item.capacity,
      description: item.description || "",
    });
    setError("");
    setMessage("");
    setTab("create");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveSession(event) {
    event.preventDefault();
    setError("");
    setMessage("");

    const start = new Date(form.starts_at);
    const end = new Date(form.ends_at);

    if (
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime())
    ) {
      setError("Choose a valid start time and end time.");
      return;
    }

    if (end <= start) {
      setError("The end time must be after the start time.");
      return;
    }

    const repairingOldSession =
      editing &&
      !editing.ends_at &&
      form.starts_at === localDateTime(editing.starts_at);

    if (start.getTime() <= Date.now() && !repairingOldSession) {
      setError("The session must start in the future.");
      return;
    }

    const selectedActivity = activities.find(
      (item) =>
        item.category === form.category && item.name === form.activity
    );

    if (!selectedActivity) {
      setError("Select an activity from the list.");
      return;
    }

    setBusy(true);

    try {
      await sessionApi(
        editing ? `/${editing.id}` : "",
        editing ? "PUT" : "POST",
        {
          ...form,
          capacity: Number(form.capacity),
          starts_at: repairingOldSession
            ? editing.starts_at
            : start.toISOString(),
          ends_at: end.toISOString(),
        }
      );

      setMessage(editing ? "Session updated." : "Session created.");
      setForm({ ...emptyForm });
      setEditing(null);
      setTab("mine");
      setRevision((value) => value + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function performAction(path, body, confirmation) {
    if (busy) return;
    if (confirmation && !window.confirm(confirmation)) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const data = await sessionApi(path, "POST", body);
      setMessage(data.message || "Updated successfully.");
      setRevision((value) => value + 1);
    } catch (err) {
      setError(err.message);
      setRevision((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }

  const activityOptions = activities
    .filter((item) => item.category === form.category)
    .map((item) => item.name);

  const filteredSessions = sessions.filter((item) => {
    const searchable = [
      item.title,
      item.activity,
      item.location,
      item.platform,
      item.region,
      item.host_name,
    ]
      .join(" ")
      .toLowerCase();

    if (search && !searchable.includes(search.toLowerCase())) return false;
    if (category && item.category !== category) return false;
    if (skill && item.skill_level !== skill) return false;
    if (date && localDateTime(item.starts_at).slice(0, 10) !== date) {
      return false;
    }

    if (
      availableOnly &&
      !(
        item.status === "Open" &&
        !item.completed_at &&
        new Date(item.starts_at).getTime() > Date.now() &&
        item.participation.available > 0
      )
    ) {
      return false;
    }

    return true;
  });

  const buttonStyle = {
    width: "auto",
    flex: "0 0 auto",
    margin: 0,
  };

  const actionsStyle = {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    alignItems: "center",
  };

  return (
    <section className="sessions-page">
      <div className="session-heading">
        <div>
          <p className="eyebrow">FIND YOUR NEXT GAME</p>
          <h1>Good company. Great games.</h1>
          <p className="muted">
            Find your team, organise a session, and make time to play.
          </p>
        </div>
        <button
          type="button"
          className="primary-button compact-button"
          disabled={busy}
          onClick={() => changeTab("create")}
        >
          Create a session
        </button>
      </div>

      <div
        className="session-tabs"
        style={{ ...actionsStyle, marginBottom: "24px" }}
      >
        {[
          ["discover", "Discover"],
          ["mine", "Hosting"],
          ["joined", "My requests & teams"],
          ["history", "History"],
          ["create", editing ? "Edit session" : "Create"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`secondary-button${tab === value ? " selected" : ""}`}
            style={buttonStyle}
            disabled={busy}
            aria-pressed={tab === value}
            onClick={() => changeTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}

      {message && (
        <p className="success-message" role="status">
          {message}
        </p>
      )}

      {tab === "create" ? (
        <div className="session-form-card">
          <h2>{editing ? "Edit your session" : "Make a plan to play"}</h2>
          <p className="muted">
            Choose the activity, minimum skill level, and the full time slot.
            The host counts towards the player limit.
          </p>

          {editing && !editing.ends_at && (
            <p className="player-note">
              This older session needs an end time before new players can join.
              You can keep its original start time.
            </p>
          )}

          <form className="session-form" onSubmit={saveSession}>
            <Field
              label="Session title"
              name="title"
              value={form.title}
              onChange={changeField}
              minLength={3}
              maxLength={100}
              required
              full
            />

            <Field
              label="Category"
              name="category"
              value={form.category}
              onChange={changeField}
              options={["Sports", "Gaming"]}
              required
            />

            <Field
              label="Activity"
              name="activity"
              value={form.activity}
              onChange={changeField}
              options={[
                { value: "", label: "Select an activity" },
                ...(form.activity && !activityOptions.includes(form.activity)
                  ? [
                      {
                        value: form.activity,
                        label: `${form.activity} — select a supported activity`,
                      },
                    ]
                  : []),
                ...activityOptions,
              ]}
              required
            />

            <Field
              label="Minimum skill level"
              name="skill_level"
              value={form.skill_level}
              onChange={changeField}
              options={levels}
              required
            />

            <Field
              label="Total players, including you"
              name="capacity"
              value={form.capacity}
              onChange={changeField}
              type="number"
              min={2}
              max={100}
              step={1}
              required
            />

            <Field
              label="Starts at"
              name="starts_at"
              value={form.starts_at}
              onChange={changeField}
              type="datetime-local"
              required
            />

            <Field
              label="Ends at"
              name="ends_at"
              value={form.ends_at}
              onChange={changeField}
              type="datetime-local"
              required
            />

            {form.category === "Sports" ? (
              <Field
                label="Venue / location"
                name="location"
                value={form.location}
                onChange={changeField}
                minLength={3}
                maxLength={150}
                required
                full
              />
            ) : (
              <>
                <Field
                  label="Platform"
                  name="platform"
                  value={form.platform}
                  onChange={changeField}
                  placeholder="PC, PlayStation, Xbox, Mobile..."
                  maxLength={60}
                  required
                />
                <Field
                  label="Server / region"
                  name="region"
                  value={form.region}
                  onChange={changeField}
                  placeholder="Mumbai, Asia, Europe..."
                  maxLength={60}
                  required
                />
              </>
            )}

            <Field
              label="Description"
              name="description"
              value={form.description}
              onChange={changeField}
              placeholder="Tell players what to expect."
              maxLength={1000}
              multiline
              full
            />

            <div className="full-width" style={actionsStyle}>
              <button
                className="primary-button"
                style={buttonStyle}
                disabled={busy || activities.length === 0}
              >
                {busy
                  ? "Saving..."
                  : editing
                    ? "Save changes"
                    : "Create session"}
              </button>
              <button
                type="button"
                className="secondary-button"
                style={buttonStyle}
                disabled={busy}
                onClick={() => changeTab("mine")}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : (
        <>
          {tab === "history" && (
            <p className="muted">
              Completed sessions you hosted or participated in appear here.
            </p>
          )}

          <div className="session-filters">
            <Field
              label="Search"
              name="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Game, title, venue, host..."
              type="search"
            />

            <Field
              label="Category"
              name="filter-category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              options={[
                { value: "", label: "All categories" },
                "Sports",
                "Gaming",
              ]}
            />

            <Field
              label="Minimum skill"
              name="filter-skill"
              value={skill}
              onChange={(event) => setSkill(event.target.value)}
              options={[{ value: "", label: "All levels" }, ...levels]}
            />

            <Field
              label="Date"
              name="filter-date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              type="date"
            />
          </div>

          {tab !== "history" && (
            <label
              className="availability-filter"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                margin: "16px 0 24px",
              }}
            >
              <input
                type="checkbox"
                checked={availableOnly}
                onChange={(event) => setAvailableOnly(event.target.checked)}
                style={{ width: "auto" }}
              />
              Show upcoming sessions with available places
            </label>
          )}

          {loading ? (
            <p className="muted" role="status">
              Loading sessions...
            </p>
          ) : filteredSessions.length === 0 ? (
            <div className="empty-state">
              <h3>
                {tab === "history"
                  ? "No completed sessions yet"
                  : "No sessions found"}
              </h3>
              <p className="muted">
                {tab === "history"
                  ? "After a session ends, its host can mark it as completed."
                  : "Try different filters or create your own session."}
              </p>
            </div>
          ) : (
            <div className="session-grid">
              {filteredSessions.map((item) => {
                const info = item.participation;
                const isHost = Number(item.host_id) === Number(user.id);
                const completed =
                  item.status === "Completed" || Boolean(item.completed_at);
                const cancelled = item.status === "Cancelled";
                const open = !completed && !cancelled;
                const start = new Date(item.starts_at).getTime();
                const end = item.ends_at
                  ? new Date(item.ends_at).getTime()
                  : null;
                const upcoming = start > Date.now();
                const ended = end !== null && end <= Date.now();
                const accepted = (info.members || []).filter(
                  (member) => member.status === "Accepted"
                );
                const pending = (info.members || []).filter(
                  (member) => member.status === "Pending"
                );
                const hasMembership = ["Pending", "Accepted", "Rejected"].includes(
                  info.my_status
                );
                const status = completed
                  ? "Completed"
                  : cancelled
                    ? "Cancelled"
                    : !item.ends_at
                      ? "End time needed"
                      : ended
                        ? "Awaiting completion"
                        : !upcoming
                          ? "In progress"
                          : info.available === 0
                            ? "Full"
                            : "Upcoming";

                return (
                  <article className="session-card" key={item.id}>
                    <div className="session-card-top">
                      <span className="category-badge">{item.category}</span>
                      <span className="session-status">{status}</span>
                    </div>

                    <p className="eyebrow">{item.activity}</p>
                    <h2>{item.title}</h2>
                    <p className="muted">
                      Hosted by {item.host_name || "Deleted account"}
                    </p>

                    <div className="session-details">
                      <p>
                        <strong>Starts:</strong> {displayDate(item.starts_at)}
                      </p>
                      <p>
                        <strong>Ends:</strong> {displayDate(item.ends_at)}
                      </p>
                      <p>
                        <strong>
                          {item.category === "Sports" ? "Venue:" : "Platform:"}
                        </strong>{" "}
                        {item.category === "Sports"
                          ? item.location
                          : `${item.platform} · ${item.region}`}
                      </p>
                      <p>
                        <strong>Minimum skill:</strong> {item.skill_level}
                      </p>
                      <p>
                        <strong>Players:</strong> {info.occupied}/{item.capacity}
                      </p>
                    </div>

                    <div className="player-progress">
                      <span
                        style={{
                          width: `${Math.min(
                            100,
                            (info.occupied / item.capacity) * 100
                          )}%`,
                        }}
                      />
                    </div>

                    {(isHost || hasMembership) && (
                      <p className="membership-badge">
                        {isHost ? "You are hosting" : info.my_status}
                      </p>
                    )}

                    {item.description && (
                      <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                        {item.description}
                      </p>
                    )}

                    {open && upcoming && (
                      <div
                        style={{
                          padding: "14px",
                          margin: "16px 0",
                          border: "1px solid #334155",
                          borderRadius: "12px",
                          background: "rgba(15, 23, 42, 0.45)",
                        }}
                      >
                        <strong>Before you join</strong>
                        <p className="muted">
                          Set your {item.activity} level in My profile. You must
                          meet the minimum level and have no overlapping accepted
                          or hosted session.
                        </p>
                        <p className="muted">
                          Accepted players cannot leave within{" "}
                          {info.withdrawal_cutoff_minutes || 30} minutes of the
                          start or after it begins.
                        </p>
                        {!isHost && !hasMembership && (
                          <p>{info.application_reason}</p>
                        )}
                      </div>
                    )}

                    {!item.ends_at && open && (
                      <p className="player-note">
                        {isHost
                          ? "Edit this session and add an end time."
                          : "The host must add an end time before applications open."}
                      </p>
                    )}

                    <div style={actionsStyle}>
                      {!isHost && !hasMembership && open && upcoming && (
                        <button
                          type="button"
                          className="primary-button"
                          style={buttonStyle}
                          disabled={busy || !info.can_apply}
                          onClick={() =>
                            performAction(`/${item.id}/join`)
                          }
                        >
                          Request to join
                        </button>
                      )}

                      {!isHost && hasMembership && !completed && (
                        <button
                          type="button"
                          className="secondary-button"
                          style={buttonStyle}
                          disabled={busy || !info.can_leave}
                          onClick={() =>
                            performAction(
                              `/${item.id}/leave`,
                              undefined,
                              info.my_status === "Accepted"
                                ? "Leave this session?"
                                : "Remove your request?"
                            )
                          }
                        >
                          {info.my_status === "Accepted"
                            ? "Leave session"
                            : "Remove request"}
                        </button>
                      )}

                      <button
                        type="button"
                        className="secondary-button"
                        style={buttonStyle}
                        onClick={() =>
                          setExpandedId(
                            expandedId === item.id ? null : item.id
                          )
                        }
                      >
                        {expandedId === item.id
                          ? "Hide players"
                          : isHost
                            ? "Players & requests"
                            : "View players"}
                      </button>

                      {isHost && open && (upcoming || !item.ends_at) && (
                        <button
                          type="button"
                          className="secondary-button"
                          style={buttonStyle}
                          disabled={busy}
                          onClick={() => editSession(item)}
                        >
                          Edit
                        </button>
                      )}

                      {isHost && open && ended && (
                        <button
                          type="button"
                          className="primary-button"
                          style={buttonStyle}
                          disabled={busy}
                          onClick={() =>
                            performAction(
                              `/${item.id}/complete`,
                              undefined,
                              "Mark this session as completed? It will move to history and its chat will close."
                            )
                          }
                        >
                          Mark completed
                        </button>
                      )}

                      {isHost && open && (
                        <button
                          type="button"
                          className="secondary-button"
                          style={buttonStyle}
                          disabled={busy}
                          onClick={() =>
                            performAction(
                              `/${item.id}/cancel`,
                              undefined,
                              "Cancel this session and notify its players?"
                            )
                          }
                        >
                          Cancel session
                        </button>
                      )}
                    </div>

                    {!isHost &&
                      hasMembership &&
                      !completed &&
                      !info.can_leave &&
                      info.leave_block_reason && (
                        <p className="player-note">
                          {info.leave_block_reason}
                        </p>
                      )}

                    {completed && (
                      <p className="player-note">
                        Completed sessions stay in your history.
                      </p>
                    )}

                    {expandedId === item.id && (
                      <div className="players-panel">
                        <h3>Team</h3>

                        <div className="player-row">
                          <strong>{item.host_name || "Deleted account"}</strong>
                          <span className="player-role">Host</span>
                        </div>

                        {accepted.map((member) => (
                          <div className="player-row" key={member.user_id}>
                            <span>{member.name}</span>
                            <span className="muted">{member.skill_level}</span>
                          </div>
                        ))}

                        {accepted.length === 0 && (
                          <p className="muted">
                            No other players have been accepted yet.
                          </p>
                        )}

                        {isHost && (
                          <>
                            <h3>Join requests</h3>
                            {pending.length === 0 ? (
                              <p className="muted">No pending requests.</p>
                            ) : (
                              pending.map((member) => (
                                <div
                                  className="request-row"
                                  key={member.user_id}
                                >
                                  <div>
                                    <strong>{member.name}</strong>
                                    <p className="muted">
                                      {item.activity}: {member.skill_level}
                                    </p>
                                  </div>

                                  {open && upcoming ? (
                                    <div style={actionsStyle}>
                                      <button
                                        type="button"
                                        className="primary-button"
                                        style={buttonStyle}
                                        disabled={busy || info.available < 1}
                                        onClick={() =>
                                          performAction(
                                            `/${item.id}/requests/${member.user_id}`,
                                            { status: "Accepted" }
                                          )
                                        }
                                      >
                                        Accept
                                      </button>
                                      <button
                                        type="button"
                                        className="secondary-button"
                                        style={buttonStyle}
                                        disabled={busy}
                                        onClick={() =>
                                          performAction(
                                            `/${item.id}/requests/${member.user_id}`,
                                            { status: "Rejected" }
                                          )
                                        }
                                      >
                                        Reject
                                      </button>
                                    </div>
                                  ) : (
                                    <p className="muted">
                                      Requests are closed.
                                    </p>
                                  )}
                                </div>
                              ))
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}