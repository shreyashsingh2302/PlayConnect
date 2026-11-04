import { useEffect, useState } from "react";
import "./Dashboard.css";

async function dashboardApi(path = "", method = "GET") {
  const response = await fetch(`/api/dashboard${path}`, {
    method,
    credentials: "same-origin",
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Unable to load your dashboard.");
  }

  return data;
}

export default function Dashboard({ user, onNavigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    let timer;

    async function loadDashboard() {
      try {
        const result = await dashboardApi();

        if (active) {
          setData(result);
          setError("");
        }
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) {
          setLoading(false);
          timer = window.setTimeout(loadDashboard, 15000);
        }
      }
    }

    loadDashboard();

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [revision]);

  async function markRead(id) {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const path =
        id === "all"
          ? "/notifications/read-all"
          : `/notifications/${id}/read`;

      const result = await dashboardApi(path, "POST");
      setMessage(result.message);
      setRevision((previous) => previous + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="session-heading">
        <div>
          <p className="eyebrow">YOUR PLAYCONNECT OVERVIEW</p>
          <h1>Welcome back, {user.name}.</h1>
          <p className="muted">
            Your upcoming games, requests, and team updates in one place.
          </p>
        </div>

        <button
          className="secondary-button"
          onClick={() => setRevision((previous) => previous + 1)}
          disabled={loading || busy}
        >
          Refresh dashboard
        </button>
      </div>

      {error && (
        <p className="error-message dashboard-alert" role="alert">
          {error}
        </p>
      )}

      {message && (
        <p className="success-message" role="status">{message}</p>
      )}

      {loading ? (
        <p role="status">Loading your dashboard…</p>
      ) : data ? (
        <>
          <div className="dashboard-stats">
            {[
              ["Hosting", data.stats.hosted, "Upcoming sessions you organise"],
              ["Playing", data.stats.joined, "Upcoming sessions you joined"],
              ["Awaiting approval", data.stats.pendingRequests, "Your pending requests"],
              ["To review", data.stats.requestsToReview, "Requests for your sessions"],
            ].map(([label, value, description]) => (
              <article className="dashboard-stat" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
                <p>{description}</p>
              </article>
            ))}
          </div>

          <div className="dashboard-shortcuts">
            <button
              className="primary-button"
              onClick={() => onNavigate("sessions")}
            >
              Explore sessions
            </button>

            <button
              className="secondary-button"
              onClick={() => onNavigate("chats")}
            >
              Open team chats
            </button>

            <button
              className="secondary-button"
              onClick={() => onNavigate("profile")}
            >
              Edit my profile
            </button>
          </div>

          <div className="dashboard-columns">
            <section className="dashboard-panel">
              <div className="dashboard-panel-heading">
                <h2>Your upcoming games</h2>
                <span>Next 10</span>
              </div>

              {data.upcoming.length === 0 ? (
                <div className="dashboard-empty">
                  <h3>Your schedule is open.</h3>
                  <p>
                    Host a session or get accepted into one to see it here.
                  </p>
                </div>
              ) : (
                <div className="upcoming-list">
                  {data.upcoming.map((item) => (
                    <article className="upcoming-item" key={item.id}>
                      <div className="upcoming-date">
                        <strong>
                          {new Date(item.starts_at).getDate()}
                        </strong>
                        <span>
                          {new Date(item.starts_at).toLocaleDateString([], {
                            month: "short",
                          })}
                        </span>
                      </div>

                      <div className="upcoming-info">
                        <span className="upcoming-category">
                          {item.category} · {item.activity}
                        </span>

                        <h3>{item.title}</h3>

                        <p>
                          {new Date(item.starts_at).toLocaleString([], {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </p>

                        <p>
                          {item.category === "Sports"
                            ? item.location
                            : `${item.platform} · ${item.region}`}
                        </p>

                        <span className="dashboard-role">
                          {item.role === "Host" ? "You are hosting" : "Team member"}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="dashboard-panel">
              <div className="dashboard-panel-heading">
                <h2>
                  Notifications
                  <span className="notification-count">
                    {data.stats.unread} unread
                  </span>
                </h2>

                <button
                  className="secondary-button"
                  onClick={() => markRead("all")}
                  disabled={busy || data.stats.unread === 0}
                >
                  Mark all read
                </button>
              </div>

              <p className="notification-help">
                Updates automatically every 15 seconds while this page is open.
              </p>

              {data.notifications.length === 0 ? (
                <div className="dashboard-empty">
                  <h3>You’re all caught up.</h3>
                  <p>
                    New requests, decisions, and session updates will appear here.
                  </p>
                </div>
              ) : (
                <div className="notification-list">
                  {data.notifications.map((item) => (
                    <article
                      key={item.id}
                      className={`notification-item ${
                        item.is_read ? "" : "unread-notification"
                      }`}
                    >
                      <p>{item.message}</p>

                      <time dateTime={item.created_at}>
                        {new Date(item.created_at).toLocaleString([], {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </time>

                      {!item.is_read && (
                        <button
                          className="notification-read-button"
                          onClick={() => markRead(item.id)}
                          disabled={busy}
                        >
                          Mark as read
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              )}

              <p className="notification-help">
                Showing the latest 50 notifications.
              </p>
            </section>
          </div>
        </>
      ) : (
        <p className="muted">
          Use Refresh dashboard to try again.
        </p>
      )}
    </section>
  );
}