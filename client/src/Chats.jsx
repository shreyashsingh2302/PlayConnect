import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./Chat.css";

async function getSessions(path) {
  const response = await fetch(`/api/sessions${path}`, {
    credentials: "same-origin",
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Unable to load chats.");
  }

  return data.sessions;
}

function mergeMessages(...lists) {
  const messages = new Map();

  for (const list of lists) {
    for (const message of list) {
      messages.set(message.id, message);
    }
  }

  return [...messages.values()]
    .sort((a, b) => a.id - b.id)
    .slice(-100);
}

function ChatRoom({ session, user }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("Connecting…");
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const socketRef = useRef(null);
  const messageListRef = useRef(null);

  useEffect(() => {
    let active = true;
    let opening = false;
    let buffered = [];
    let connectionAttempt = 0;

    const socket = io({
      autoConnect: false,
      withCredentials: true,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      const attempt = ++connectionAttempt;

      opening = true;
      buffered = [];
      setReady(false);
      setStatus("Opening chat…");
      setError("");

      socket.timeout(10000).emit(
        "chat:open",
        { sessionId: session.id },
        (timeoutError, response) => {
          if (!active || attempt !== connectionAttempt) return;

          opening = false;

          if (timeoutError || response?.error || !response) {
            setReady(false);
            setMessages([]);
            setStatus("Chat unavailable");
            setError(
              response?.error ||
                "Chat did not respond. Use Reconnect to try again."
            );
            return;
          }

          setMessages(mergeMessages(response.messages || [], buffered));
          buffered = [];
          setReady(true);
          setStatus("Connected");
        }
      );
    });

    socket.on("chat:message", (message) => {
      if (!active || message.session_id !== session.id) return;

      if (opening) {
        buffered.push(message);
      } else {
        setMessages((previous) => mergeMessages(previous, [message]));
      }
    });

    socket.on("chat:denied", (data) => {
      if (!active) return;

      connectionAttempt += 1;
      opening = false;
      buffered = [];
      setMessages([]);
      setReady(false);
      setStatus("Access ended");
      setError(data?.error || "You no longer have access to this chat.");
    });

    socket.on("disconnect", () => {
      if (!active) return;

      connectionAttempt += 1;
      setReady(false);
      setStatus("Disconnected");
    });

    socket.on("connect_error", (err) => {
      if (!active) return;

      setReady(false);
      setStatus("Connection failed");
      setError(err.message || "Unable to connect to chat.");
    });

    socket.connect();

    return () => {
      active = false;
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [session.id]);

  useEffect(() => {
    const list = messageListRef.current;

    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages]);

  function reconnect() {
    const socket = socketRef.current;
    if (!socket) return;

    setError("");
    setReady(false);
    setStatus("Connecting…");
    socket.disconnect();
    socket.connect();
  }

  function sendMessage(event) {
    event.preventDefault();

    const content = draft.trim();
    const socket = socketRef.current;

    if (!content || sending || !ready || !socket?.connected) return;

    setSending(true);
    setError("");

    socket.timeout(10000).emit(
      "chat:send",
      { sessionId: session.id, content },
      (timeoutError, response) => {
        // Ignore acknowledgements belonging to a closed chat.
        if (socketRef.current !== socket) return;

        setSending(false);

        if (timeoutError) {
          setError(
            "Delivery was not confirmed. Reconnect to check the history before sending again."
          );
          return;
        }

        if (response?.error || !response?.message) {
          setError(response?.error || "Unable to send message.");
          return;
        }

        setMessages((previous) =>
          mergeMessages(previous, [response.message])
        );
        setDraft("");
      }
    );
  }

  return (
    <section className="chat-room" aria-label={`Chat for ${session.title}`}>
      <div className="chat-room-header">
        <div>
          <p className="eyebrow">{session.activity}</p>
          <h2>{session.title}</h2>
          <p className="chat-connection" role="status">{status}</p>
        </div>

        <button
          className="secondary-button"
          onClick={reconnect}
          disabled={sending}
        >
          Reconnect
        </button>
      </div>

      <div
        className="chat-messages"
        ref={messageListRef}
        role="log"
        aria-label="Session messages"
        aria-live="polite"
        aria-relevant="additions"
        tabIndex={0}
      >
        {messages.length === 0 && (
          <div className="chat-empty">
            <h3>{ready ? "Start the conversation." : "Your session chat"}</h3>
            <p>
              {ready
                ? "Coordinate your meeting point, game mode, or lobby details."
                : "Messages will appear after the connection is ready."}
            </p>
          </div>
        )}

        {messages.map((message) => {
          const own = message.user_id === user.id;

          return (
            <article
              key={message.id}
              className={`chat-message ${own ? "own-message" : ""}`}
            >
              <div className="chat-message-meta">
                <strong>{own ? "You" : message.sender_name}</strong>
                <time dateTime={message.created_at}>
                  {new Date(message.created_at).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </div>

              <p>{message.content}</p>
            </article>
          );
        })}
      </div>

      {error && (
        <p className="error-message chat-error" role="alert">{error}</p>
      )}

      <form className="chat-compose" onSubmit={sendMessage}>
        <label htmlFor="chat-message-input">Your message</label>

        <div className="chat-compose-row">
          <textarea
            id="chat-message-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Message your team..."
            maxLength={1000}
            rows={2}
            disabled={!ready || sending}
            required
          />

          <button
            type="submit"
            className="primary-button compact-button"
            disabled={!ready || sending || !draft.trim()}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>

        <p className="chat-hint">
          {draft.length}/1000 characters · Latest 100 messages displayed
        </p>
      </form>
    </section>
  );
}

export default function Chats({ user }) {
  const [sessions, setSessions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadChats() {
      setLoading(true);
      setError("");

      try {
        const [hosted, joined] = await Promise.all([
          getSessions("?mine=true"),
          getSessions("/joined"),
        ]);

        const eligible = [
          ...hosted.filter((item) => item.status === "Open"),
          ...joined.filter(
            (item) =>
              item.status === "Open" &&
              item.membership_status === "Accepted"
          ),
        ];

        const unique = [...new Map(
          eligible.map((item) => [item.id, item])
        ).values()].sort(
          (a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)
        );

        if (!active) return;

        setSessions(unique);
        setSelectedId((previous) =>
          unique.some((item) => item.id === previous)
            ? previous
            : unique[0]?.id ?? null
        );
      } catch (err) {
        if (active) {
          setError(err.message);
          setSessions([]);
          setSelectedId(null);
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadChats();

    return () => {
      active = false;
    };
  }, [revision]);

  const selected = sessions.find((item) => item.id === selectedId);

  return (
    <section>
      <div className="session-heading">
        <div>
          <p className="eyebrow">KEEP YOUR TEAM CONNECTED</p>
          <h1>Session chats</h1>
          <p className="muted">
            Private conversations for hosts and accepted players.
          </p>
        </div>

        <button
          className="secondary-button"
          onClick={() => setRevision((previous) => previous + 1)}
          disabled={loading}
        >
          Refresh chats
        </button>
      </div>

      {error && <p className="error-message" role="alert">{error}</p>}

      {loading ? (
        <p role="status">Loading your chats…</p>
      ) : !error && sessions.length === 0 ? (
        <div className="session-empty">
          <h2>No chats available yet.</h2>
          <p>
            Host a session or get accepted into one to unlock its chat.
            Cancelled sessions are closed to chat.
          </p>
        </div>
      ) : !error ? (
        <div className="chat-layout">
          <nav className="chat-sidebar" aria-label="Choose a session chat">
            {sessions.map((item) => (
              <button
                key={item.id}
                className={`chat-selector ${
                  selectedId === item.id ? "active-chat" : ""
                }`}
                onClick={() => setSelectedId(item.id)}
                aria-pressed={selectedId === item.id}
              >
                <span className="chat-selector-category">
                  {item.category} · {item.activity}
                </span>
                <strong>{item.title}</strong>
                <span>
                  {item.host_id === user.id ? "You are hosting" : "Team member"}
                </span>
              </button>
            ))}
          </nav>

          {selected && (
            <ChatRoom key={selected.id} session={selected} user={user} />
          )}
        </div>
      ) : null}
    </section>
  );
}