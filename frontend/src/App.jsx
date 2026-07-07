import { useEffect, useState } from "react";
import { createRoom } from "./services/api";
import Whiteboard from "./components/Whiteboard";

const NAME_KEY = "inkflow.displayName";

function loadName() {
  return localStorage.getItem(NAME_KEY) || "";
}

export default function App() {
  const [view, setView] = useState("landing");
  const [roomId, setRoomId] = useState("");
  const [displayName, setDisplayName] = useState(loadName);
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get("room");
    if (room) {
      setRoomId(room.toUpperCase());
      setView("board");
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(NAME_KEY, displayName);
  }, [displayName]);

  function goToRoom(id) {
    const code = id.toUpperCase();
    setRoomId(code);
    setView("board");
    const url = new URL(window.location.href);
    url.searchParams.set("room", code);
    window.history.replaceState({}, "", url);
  }

  async function handleCreateRoom() {
    try {
      setLoading(true);
      setError("");
      const { roomId: newRoom } = await createRoom();
      goToRoom(newRoom);
    } catch {
      setError("Could not create a room. Is the backend running?");
    } finally {
      setLoading(false);
    }
  }

  function handleJoinRoom(event) {
    event.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) {
      setError("Enter a valid room code.");
      return;
    }
    setError("");
    goToRoom(code);
  }

  if (view === "board" && roomId) {
    return (
      <Whiteboard
        roomId={roomId}
        displayName={displayName || "Guest"}
        onLeave={() => {
          setView("landing");
          setRoomId("");
          const url = new URL(window.location.href);
          url.searchParams.delete("room");
          window.history.replaceState({}, "", url);
        }}
      />
    );
  }

  return (
    <div className="landing">
      <div className="aurora aurora-a" />
      <div className="aurora aurora-b" />
      <div className="aurora aurora-c" />

      <header className="landing-header">
        <div className="logo-mark">IF</div>
        <div>
          <h1>InkFlow</h1>
          <p className="tagline">Where ideas stream together</p>
        </div>
      </header>

      <main className="landing-main">
        <section className="hero-card glass">
          <h2>Collaborative whiteboard, zero friction</h2>
          <p>
            Sketch in real time, drop colorful sticky notes, and share a room link — no account
            required. InkFlow is built for brainstorms, wireframes, and quick visual thinking.
          </p>

          <label className="name-field">
            Your display name
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Paras"
              maxLength={24}
            />
          </label>

          <div className="hero-actions">
            <button
              className="btn-primary"
              onClick={handleCreateRoom}
              disabled={loading}
              title={loading ? "Creating room" : "Create new room"}
              aria-label={loading ? "Creating room" : "Create new room"}
            >
              {loading ? "⏳" : "✨"}
            </button>
          </div>

          <form className="join-form" onSubmit={handleJoinRoom}>
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="Enter room code"
              maxLength={8}
            />
            <button
              type="submit"
              className="btn-secondary"
              title="Join room"
              aria-label="Join room"
            >
              🚪
            </button>
          </form>

          {error && <p className="error-text">{error}</p>}
        </section>

        <section className="features">
          <article className="feature-card glass">
            <span className="feature-icon">⚡</span>
            <h3>Instant rooms</h3>
            <p>6-character codes — share a link and start drawing in seconds.</p>
          </article>
          <article className="feature-card glass">
            <span className="feature-icon">👥</span>
            <h3>Live cursors</h3>
            <p>See teammates move in real time with color-coded presence.</p>
          </article>
          <article className="feature-card glass">
            <span className="feature-icon">📌</span>
            <h3>Sticky notes</h3>
            <p>Capture ideas on colorful notes right on the canvas.</p>
          </article>
          <article className="feature-card glass">
            <span className="feature-icon">💾</span>
            <h3>Save boards</h3>
            <p>Export PNG snapshots or save named boards to your gallery.</p>
          </article>
        </section>
      </main>

      <footer className="landing-footer">
        <p>Made by Paras Khati</p>
      </footer>
    </div>
  );
}
