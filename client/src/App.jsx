import { useEffect, useState } from "react";
import Profile from "./Profile";
import Sessions from "./Sessions";
import Chats from "./Chats";
import Dashboard from "./Dashboard";
import "./App.css";

async function api(path, body) {
  const response = await fetch(`/api/auth/${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Request failed. Please try again.");
  }

  return data;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [mode, setMode] = useState("login");
  const [page, setPage] = useState("dashboard");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
  });

  useEffect(() => {
    let active = true;

    api("me")
      .then((data) => {
        if (active) setUser(data.user);
      })
      .catch(() => {
        if (active) {
          setError(
            "Cannot reach the server. Check that your backend is running."
          );
        }
      })
      .finally(() => {
        if (active) setChecking(false);
      });

    return () => {
      active = false;
    };
  }, []);

  function navigate(nextPage) {
    setPage(nextPage);
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateField(event) {
    setForm((previous) => ({
      ...previous,
      [event.target.name]: event.target.value,
    }));
  }

  function changeMode(nextMode) {
    setMode(nextMode);
    setError("");
    setForm({ name: "", email: "", password: "" });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);

    try {
      const data = await api(mode, form);
      setUser(data.user);
      setPage("dashboard");
      setForm({ name: "", email: "", password: "" });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function clearLogin() {
    setUser(null);
    setMode("login");
    setPage("dashboard");
    setError("");
    setForm({ name: "", email: "", password: "" });
  }

  async function handleLogout() {
    setBusy(true);
    setError("");

    try {
      await api("logout", {});
      clearLogin();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="PlayConnect home">
          <span className="brand-icon">P</span>
          <span>
            Play<span className="accent">Connect</span>
          </span>
        </a>

        {user ? (
          <nav className="member-nav" aria-label="Main navigation">
            {[
              ["dashboard", "Dashboard"],
              ["sessions", "Sessions"],
              ["chats", "Chats"],
              ["profile", "My profile"],
            ].map(([value, label]) => (
              <button
                key={value}
                className={`secondary-button ${
                  page === value ? "selected" : ""
                }`}
                onClick={() => navigate(value)}
                aria-pressed={page === value}
              >
                {label}
              </button>
            ))}

            <button
              className="secondary-button"
              onClick={handleLogout}
              disabled={busy}
            >
              {busy ? "Signing out…" : "Sign out"}
            </button>
          </nav>
        ) : (
          <span className="header-label">SPORTS + GAMING</span>
        )}
      </header>

      {checking ? (
        <main className="workspace">
          <p role="status">Checking your login…</p>
        </main>
      ) : user ? (
        <main className="workspace">
          {error && (
            <p className="error-message" role="alert">{error}</p>
          )}

          {page === "dashboard" ? (
            <Dashboard
              key={user.id}
              user={user}
              onNavigate={navigate}
            />
          ) : page === "sessions" ? (
            <Sessions key={user.id} user={user} />
          ) : page === "chats" ? (
            <Chats key={user.id} user={user} />
          ) : (
            <section className="auth-card profile-page">
              <p className="eyebrow">YOUR PLAYER IDENTITY</p>

              <div className="avatar">
                {user.name.charAt(0).toUpperCase()}
              </div>

              <h2>{user.name}</h2>

              <p className="muted">
                Update your details and tell players what you enjoy.
              </p>

              <div className="account-details">
                <span>ACCOUNT EMAIL</span>
                <strong>{user.email}</strong>
              </div>

              <Profile
                key={user.id}
                user={user}
                onUpdate={setUser}
                onDelete={clearLogin}
              />
            </section>
          )}
        </main>
      ) : (
        <main className="auth-layout">
          <section className="intro">
            <p className="eyebrow">YOUR NEXT GAME STARTS HERE</p>

            <h1>
              Find your people.
              <br />
              <span className="accent">Make your play.</span>
            </h1>

            <p className="intro-description">
              From the football pitch to your favourite online lobby,
              connect with players who are ready to team up.
            </p>

            <div className="activity-tags" aria-label="Example activities">
              <span>Football</span>
              <span>Valorant</span>
              <span>Badminton</span>
              <span>EA FC</span>
              <span>Basketball</span>
              <span>Minecraft</span>
            </div>

            <div className="intro-cards">
              <article>
                <span className="card-number">01 / ON THE GROUND</span>
                <h2>Meet. Team up. Play.</h2>
                <p>
                  Find local players and organise your next sports session.
                </p>
              </article>

              <article>
                <span className="card-number">02 / IN THE LOBBY</span>
                <h2>Your squad is out there.</h2>
                <p>
                  Connect over your favourite games, platforms, and play styles.
                </p>
              </article>
            </div>
          </section>

          <section className="auth-card" aria-labelledby="auth-title">
            <div className="auth-tabs">
              <button
                type="button"
                className={mode === "login" ? "active" : ""}
                aria-pressed={mode === "login"}
                onClick={() => changeMode("login")}
                disabled={busy}
              >
                Sign in
              </button>

              <button
                type="button"
                className={mode === "register" ? "active" : ""}
                aria-pressed={mode === "register"}
                onClick={() => changeMode("register")}
                disabled={busy}
              >
                Create account
              </button>
            </div>

            <h2 id="auth-title">
              {mode === "login" ? "Welcome back." : "Find your next team."}
            </h2>

            <p className="muted">
              {mode === "login"
                ? "Sign in and get back in the game."
                : "Create your account to get started."}
            </p>

            <form onSubmit={handleSubmit}>
              {mode === "register" && (
                <label>
                  Full name
                  <input
                    name="name"
                    value={form.name}
                    onChange={updateField}
                    placeholder="Your name"
                    autoComplete="name"
                    minLength={2}
                    maxLength={60}
                    required
                  />
                </label>
              )}

              <label>
                Email address
                <input
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={updateField}
                  placeholder="you@example.com"
                  autoComplete="email"
                  maxLength={254}
                  required
                />
              </label>

              <label>
                Password
                <input
                  name="password"
                  type="password"
                  value={form.password}
                  onChange={updateField}
                  placeholder={
                    mode === "register"
                      ? "Create a password"
                      : "Enter your password"
                  }
                  autoComplete={
                    mode === "register"
                      ? "new-password"
                      : "current-password"
                  }
                  minLength={mode === "register" ? 8 : undefined}
                  required
                />
              </label>

              {mode === "register" && (
                <p className="field-hint">Use at least 8 characters.</p>
              )}

              {error && (
                <p className="error-message" role="alert">{error}</p>
              )}

              <button
                type="submit"
                className="primary-button"
                disabled={busy}
              >
                {busy
                  ? "Please wait…"
                  : mode === "login"
                    ? "Sign in →"
                    : "Create account →"}
              </button>
            </form>

            <p className="card-footer">
              One community. Every kind of player.
            </p>
          </section>
        </main>
      )}

      <footer className="site-footer">
        <span>PlayConnect</span>
        <span>Good games start with good company.</span>
      </footer>
    </div>
  );
}