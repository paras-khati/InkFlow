import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  TOOLS,
  PALETTE,
  STICKY_COLORS,
  uid,
  buildPenPath,
  elementBounds,
  hitTest,
  renderElement,
  exportToPng,
} from "../utils/drawing";
import { fetchBoards, getSocketUrl, loadBoard, saveBoard } from "../services/api";

const TOOL_META = {
  [TOOLS.PEN]: { emoji: "✏️", label: "Pen" },
  [TOOLS.ERASER]: { emoji: "🧽", label: "Eraser" },
  [TOOLS.RECT]: { emoji: "⬜", label: "Rectangle" },
  [TOOLS.ELLIPSE]: { emoji: "⭕", label: "Ellipse" },
  [TOOLS.LINE]: { emoji: "➖", label: "Line" },
  [TOOLS.ARROW]: { emoji: "➡️", label: "Arrow" },
  [TOOLS.TEXT]: { emoji: "🔤", label: "Text" },
  [TOOLS.STICKY]: { emoji: "📌", label: "Sticky Note" },
  [TOOLS.SELECT]: { emoji: "👆", label: "Select" },
};

function SvgNode({ node }) {
  if (!node) return null;
  if (node.tag === "g") {
    return (
      <g>
        {node.children.map((child, i) => (
          <SvgNode key={i} node={child} />
        ))}
      </g>
    );
  }
  const Tag = node.tag;
  return <Tag {...node.props} />;
}

export default function Whiteboard({ roomId, displayName, onLeave }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const socketRef = useRef(null);
  const elementsRef = useRef([]);
  const draftRef = useRef(null);
  const isRemoteUpdate = useRef(false);
  const panStart = useRef(null);
  const historyRef = useRef({ items: [[]], index: 0 });

  const [elements, setElements] = useState([]);
  const [tool, setTool] = useState(TOOLS.PEN);
  const [color, setColor] = useState(PALETTE[5]);
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [stickyColor, setStickyColor] = useState(STICKY_COLORS[0]);
  const [presence, setPresence] = useState([]);
  const [connected, setConnected] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [history, setHistory] = useState([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [textPrompt, setTextPrompt] = useState(null);
  const [stickyEdit, setStickyEdit] = useState(null);
  const [saveName, setSaveName] = useState("");
  const [boards, setBoards] = useState([]);
  const [showGallery, setShowGallery] = useState(false);
  const [toast, setToast] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  elementsRef.current = elements;

  const pushHistory = useCallback((nextElements) => {
    const { items, index } = historyRef.current;
    const trimmed = items.slice(0, index + 1);
    const next = [...trimmed, nextElements];
    historyRef.current = { items: next, index: next.length - 1 };
    setHistory(next);
    setHistoryIndex(next.length - 1);
  }, []);

  const commitElements = useCallback(
    (nextElements, recordHistory = true) => {
      setElements(nextElements);
      if (recordHistory) pushHistory(nextElements);
      if (!isRemoteUpdate.current && socketRef.current?.connected) {
        socketRef.current.emit("drawingUpdate", { elements: nextElements });
      }
    },
    [pushHistory]
  );

  const undo = useCallback(() => {
    const { items, index } = historyRef.current;
    if (index <= 0) return;
    const nextIndex = index - 1;
    historyRef.current = { items, index: nextIndex };
    setHistoryIndex(nextIndex);
    commitElements(items[nextIndex], false);
  }, [commitElements]);

  const redo = useCallback(() => {
    const { items, index } = historyRef.current;
    if (index >= items.length - 1) return;
    const nextIndex = index + 1;
    historyRef.current = { items, index: nextIndex };
    setHistoryIndex(nextIndex);
    commitElements(items[nextIndex], false);
  }, [commitElements]);

  useEffect(() => {
    const socket = io(getSocketUrl(), { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("joinRoom", { roomId, name: displayName });
    });
    socket.on("disconnect", () => setConnected(false));

    socket.on("roomState", ({ elements: initial, presence: users }) => {
      isRemoteUpdate.current = true;
      historyRef.current = { items: [initial], index: 0 };
      setElements(initial);
      setHistory([initial]);
      setHistoryIndex(0);
      setPresence(users);
      isRemoteUpdate.current = false;
    });

    socket.on("drawingUpdate", ({ elements: remote }) => {
      isRemoteUpdate.current = true;
      setElements(remote);
      isRemoteUpdate.current = false;
    });

    socket.on("userJoined", (user) => {
      setPresence((prev) => [...prev.filter((u) => u.id !== user.id), user]);
    });
    socket.on("userLeft", ({ id }) => {
      setPresence((prev) => prev.filter((u) => u.id !== id));
    });
    socket.on("cursorUpdate", ({ id, x, y }) => {
      setPresence((prev) => prev.map((u) => (u.id === id ? { ...u, x, y } : u)));
    });

    return () => socket.disconnect();
  }, [roomId, displayName]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        setSpaceHeld(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    }
    function onKeyUp(e) {
      if (e.code === "Space") setSpaceHeld(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [undo, redo]);

  function screenToWorld(clientX, clientY) {
    const rect = containerRef.current.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return {
      x: (sx - pan.x) / zoom,
      y: (sy - pan.y) / zoom,
    };
  }

  function emitCursor(clientX, clientY) {
    const { x, y } = screenToWorld(clientX, clientY);
    socketRef.current?.emit("cursorMove", { x, y });
  }

  function handlePointerDown(e) {
    if (e.button === 1 || spaceHeld || e.button === 2) {
      setIsPanning(true);
      panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      return;
    }

    const { x, y } = screenToWorld(e.clientX, e.clientY);

    if (tool === TOOLS.SELECT) {
      const hit = [...elementsRef.current].reverse().find((el) => hitTest(el, x, y));
      setSelectedId(hit?.id || null);
      return;
    }

    if (tool === TOOLS.TEXT) {
      setTextPrompt({ x, y, value: "" });
      return;
    }

    if (tool === TOOLS.STICKY) {
      const sticky = {
        id: uid(),
        type: "sticky",
        x: x - 90,
        y: y - 70,
        width: 180,
        height: 140,
        color: stickyColor,
        text: "New note",
      };
      commitElements([...elementsRef.current, sticky]);
      setStickyEdit({ id: sticky.id, value: sticky.text });
      return;
    }

    if (tool === TOOLS.PEN || tool === TOOLS.ERASER) {
      draftRef.current = {
        id: uid(),
        type: tool,
        points: [[x, y, e.pressure || 0.5]],
        color: tool === TOOLS.ERASER ? "#0b1020" : color,
        strokeWidth: tool === TOOLS.ERASER ? strokeWidth * 3 : strokeWidth,
      };
      return;
    }

    draftRef.current = {
      id: uid(),
      type: tool,
      x1: x,
      y1: y,
      x2: x,
      y2: y,
      color,
      strokeWidth,
    };
  }

  function handlePointerMove(e) {
    emitCursor(e.clientX, e.clientY);

    if (isPanning && panStart.current) {
      setPan({
        x: e.clientX - panStart.current.x,
        y: e.clientY - panStart.current.y,
      });
      return;
    }

    const draft = draftRef.current;
    if (!draft) return;

    const { x, y } = screenToWorld(e.clientX, e.clientY);

    if (draft.type === TOOLS.PEN || draft.type === TOOLS.ERASER) {
      draft.points.push([x, y, e.pressure || 0.5]);
      setElements([...elementsRef.current.filter((el) => el.id !== draft.id), draft]);
      return;
    }

    draft.x2 = x;
    draft.y2 = y;
    setElements([...elementsRef.current.filter((el) => el.id !== draft.id), draft]);
  }

  function handlePointerUp() {
    if (isPanning) {
      setIsPanning(false);
      panStart.current = null;
      return;
    }

    const draft = draftRef.current;
    if (!draft) return;
    draftRef.current = null;
    commitElements([...elementsRef.current.filter((el) => el.id !== draft.id), draft]);
  }

  function deleteSelected() {
    if (!selectedId) return;
    commitElements(elementsRef.current.filter((el) => el.id !== selectedId));
    setSelectedId(null);
  }

  function clearCanvas() {
    if (!window.confirm("Clear the entire board?")) return;
    commitElements([]);
    setSelectedId(null);
  }

  async function handleExport() {
    if (!svgRef.current || !containerRef.current) return;
    const { width, height } = containerRef.current.getBoundingClientRect();
    try {
      const blob = await exportToPng(svgRef.current, width, height);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `inkflow-${roomId}.png`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("Exported PNG");
    } catch {
      showToast("Export failed");
    }
  }

  async function handleSaveBoard() {
    if (!saveName.trim()) {
      showToast("Enter a board name");
      return;
    }
    try {
      await saveBoard(saveName.trim(), elementsRef.current);
      setSaveName("");
      showToast("Board saved");
      if (showGallery) refreshBoards();
    } catch {
      showToast("Save failed — is backend running?");
    }
  }

  async function refreshBoards() {
    try {
      const { items } = await fetchBoards();
      setBoards(items);
    } catch {
      showToast("Could not load gallery");
    }
  }

  async function handleLoadBoard(id) {
    try {
      const board = await loadBoard(id);
      commitElements(board.elements || []);
      showToast(`Loaded "${board.name}"`);
      setShowGallery(false);
    } catch {
      showToast("Load failed");
    }
  }

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  }

  function copyRoomLink() {
    navigator.clipboard.writeText(window.location.href);
    showToast("Room link copied");
  }

  const viewBox = useMemo(() => {
    const w = containerRef.current?.clientWidth || 1200;
    const h = containerRef.current?.clientHeight || 800;
    return `0 0 ${w} ${h}`;
  }, [elements, zoom, pan]);

  const draft = draftRef.current;

  return (
    <div className="board-app">
      <header className="board-toolbar glass">
        <div className="toolbar-left">
          <button className="icon-btn" onClick={onLeave} title="Leave room" aria-label="Leave room">
            🚪
          </button>
          <div className="room-badge">
            <span className="room-code">{roomId}</span>
            <button className="text-btn" onClick={copyRoomLink} title="Copy link" aria-label="Copy link">
              🔗
            </button>
          </div>
          <span className={`status-dot ${connected ? "online" : "offline"}`} title={connected ? "Connected" : "Offline"} />
        </div>

        <div className="tool-group">
          {Object.values(TOOLS).map((t) => (
            <button
              key={t}
              className={`tool-btn ${tool === t ? "active" : ""}`}
              onClick={() => setTool(t)}
              title={TOOL_META[t].label}
              aria-label={TOOL_META[t].label}
            >
              {TOOL_META[t].emoji}
            </button>
          ))}
        </div>

        <div className="toolbar-right">
          <button className="text-btn" onClick={undo} disabled={historyIndex <= 0} title="Undo" aria-label="Undo">
            ↩️
          </button>
          <button
            className="text-btn"
            onClick={redo}
            disabled={historyIndex >= history.length - 1}
            title="Redo"
            aria-label="Redo"
          >
            ↪️
          </button>
          <button
            className="text-btn"
            onClick={deleteSelected}
            disabled={!selectedId}
            title="Delete"
            aria-label="Delete"
          >
            🗑️
          </button>
          <button className="text-btn" onClick={clearCanvas} title="Clear canvas" aria-label="Clear canvas">
            🧹
          </button>
          <button className="text-btn" onClick={handleExport} title="Export PNG" aria-label="Export PNG">
            📤
          </button>
          <button
            className="text-btn"
            onClick={() => {
              setShowGallery((v) => !v);
              if (!showGallery) refreshBoards();
            }}
            title="Board gallery"
            aria-label="Board gallery"
          >
            🖼️
          </button>
        </div>
      </header>

      <aside className="side-panel glass">
        <h3>Brush</h3>
        <label>
          Size
          <input
            type="range"
            min="1"
            max="24"
            value={strokeWidth}
            onChange={(e) => setStrokeWidth(Number(e.target.value))}
          />
        </label>

        <h3>Colors</h3>
        <div className="swatches">
          {PALETTE.map((c) => (
            <button
              key={c}
              className={`swatch ${color === c ? "active" : ""}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              title={c}
            />
          ))}
        </div>

        {tool === TOOLS.STICKY && (
          <>
            <h3>Sticky color</h3>
            <div className="swatches">
              {STICKY_COLORS.map((c) => (
                <button
                  key={c}
                  className={`swatch ${stickyColor === c ? "active" : ""}`}
                  style={{ background: c }}
                  onClick={() => setStickyColor(c)}
                />
              ))}
            </div>
          </>
        )}

        <h3>View</h3>
        <div className="zoom-controls">
          <button
            onClick={() => setZoom((z) => Math.min(z + 0.1, 3))}
            title="Zoom in"
            aria-label="Zoom in"
          >
            🔍
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom((z) => Math.max(z - 0.1, 0.3))}
            title="Zoom out"
            aria-label="Zoom out"
          >
            🔎
          </button>
          <button
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            title="Reset view"
            aria-label="Reset view"
          >
            🎯
          </button>
        </div>

        <h3>Save board</h3>
        <input
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          placeholder="Board name"
        />
        <button
          className="btn-primary small"
          onClick={handleSaveBoard}
          title="Save to gallery"
          aria-label="Save to gallery"
        >
          💾
        </button>

        <h3>Online ({presence.length})</h3>
        <ul className="presence-list">
          {presence.map((u) => (
            <li key={u.id}>
              <span className="presence-dot" style={{ background: u.color }} />
              {u.name}
            </li>
          ))}
        </ul>
      </aside>

      <div
        ref={containerRef}
        className={`canvas-wrap ${isPanning || spaceHeld ? "panning" : ""}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        <svg ref={svgRef} className="canvas-svg" viewBox={viewBox}>
          <rect width="100%" height="100%" fill="#0b1020" />
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(148,163,184,0.12)" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="4000" height="4000" x="-2000" y="-2000" fill="url(#grid)" />

            {elements.map((el) => {
              if (el.type === "sticky") {
                return (
                  <g key={el.id} onDoubleClick={() => setStickyEdit({ id: el.id, value: el.text })}>
                    <rect
                      x={el.x}
                      y={el.y}
                      width={el.width}
                      height={el.height}
                      rx={8}
                      fill={el.color}
                      stroke={selectedId === el.id ? "#38bdf8" : "rgba(15,23,42,0.2)"}
                      strokeWidth={selectedId === el.id ? 3 : 1}
                    />
                    <text x={el.x + 12} y={el.y + 28} fill="#1e293b" fontSize="14" fontFamily="DM Sans, sans-serif">
                      {el.text.split("\n").map((line, i) => (
                        <tspan key={i} x={el.x + 12} dy={i === 0 ? 0 : 18}>
                          {line}
                        </tspan>
                      ))}
                    </text>
                  </g>
                );
              }
              if (el.type === "text") {
                return (
                  <text
                    key={el.id}
                    x={el.x}
                    y={el.y}
                    fill={el.color}
                    fontSize={el.fontSize}
                    fontFamily="DM Sans, sans-serif"
                    stroke={selectedId === el.id ? "#38bdf8" : "none"}
                    strokeWidth={selectedId === el.id ? 1 : 0}
                  >
                    {el.text}
                  </text>
                );
              }
              const node = renderElement(el);
              return (
                <g key={el.id}>
                  <SvgNode node={node} />
                  {selectedId === el.id && el.type !== "pen" && el.type !== "eraser" && (() => {
                    const b = elementBounds(el);
                    return (
                      <rect
                        x={b.x - 4}
                        y={b.y - 4}
                        width={b.w + 8}
                        height={b.h + 8}
                        fill="none"
                        stroke="#38bdf8"
                        strokeWidth={2}
                        strokeDasharray="6 4"
                      />
                    );
                  })()}
                </g>
              );
            })}

            {draft && (draft.type === TOOLS.PEN || draft.type === TOOLS.ERASER) && (
              <path d={buildPenPath(draft.points, draft.strokeWidth)} fill={draft.color} />
            )}
            {draft && draft.type !== TOOLS.PEN && draft.type !== TOOLS.ERASER && draft.type !== "sticky" && draft.type !== "text" && (
              <SvgNode node={renderElement(draft)} />
            )}
          </g>
        </svg>

        {presence.map(
          (u) =>
            u.x != null && (
              <div
                key={u.id}
                className="remote-cursor"
                style={{
                  transform: `translate(${u.x * zoom + pan.x}px, ${u.y * zoom + pan.y}px)`,
                  "--cursor-color": u.color,
                }}
              >
                <svg width="16" height="20" viewBox="0 0 16 20">
                  <path d="M0 0 L0 14 L4 11 L7 18 L9 17 L6 10 L11 10 Z" fill={u.color} />
                </svg>
                <span>{u.name}</span>
              </div>
            )
        )}
      </div>

      {textPrompt && (
        <div className="modal-backdrop">
          <div className="modal glass">
            <h3>Add text</h3>
            <input
              autoFocus
              value={textPrompt.value}
              onChange={(e) => setTextPrompt({ ...textPrompt, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && textPrompt.value.trim()) {
                  commitElements([
                    ...elementsRef.current,
                    {
                      id: uid(),
                      type: "text",
                      x: textPrompt.x,
                      y: textPrompt.y,
                      text: textPrompt.value.trim(),
                      color,
                      fontSize: 22,
                    },
                  ]);
                  setTextPrompt(null);
                }
                if (e.key === "Escape") setTextPrompt(null);
              }}
            />
            <div className="modal-actions">
              <button
                className="btn-secondary"
                onClick={() => setTextPrompt(null)}
                title="Cancel"
                aria-label="Cancel"
              >
                ❌
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  if (!textPrompt.value.trim()) return;
                  commitElements([
                    ...elementsRef.current,
                    {
                      id: uid(),
                      type: "text",
                      x: textPrompt.x,
                      y: textPrompt.y,
                      text: textPrompt.value.trim(),
                      color,
                      fontSize: 22,
                    },
                  ]);
                  setTextPrompt(null);
                }}
                title="Add text"
                aria-label="Add text"
              >
                ✅
              </button>
            </div>
          </div>
        </div>
      )}

      {stickyEdit && (
        <div className="modal-backdrop">
          <div className="modal glass">
            <h3>Edit sticky note</h3>
            <textarea
              autoFocus
              rows={5}
              value={stickyEdit.value}
              onChange={(e) => setStickyEdit({ ...stickyEdit, value: e.target.value })}
            />
            <div className="modal-actions">
              <button
                className="btn-secondary"
                onClick={() => setStickyEdit(null)}
                title="Cancel"
                aria-label="Cancel"
              >
                ❌
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  commitElements(
                    elementsRef.current.map((el) =>
                      el.id === stickyEdit.id ? { ...el, text: stickyEdit.value } : el
                    )
                  );
                  setStickyEdit(null);
                }}
                title="Save sticky note"
                aria-label="Save sticky note"
              >
                💾
              </button>
            </div>
          </div>
        </div>
      )}

      {showGallery && (
        <div className="modal-backdrop" onClick={() => setShowGallery(false)}>
          <div className="modal gallery-modal glass" onClick={(e) => e.stopPropagation()}>
            <h3>Saved boards</h3>
            {boards.length === 0 ? (
              <p className="muted">No saved boards yet.</p>
            ) : (
              <ul className="gallery-list">
                {boards.map((b) => (
                  <li key={b.id}>
                    <div>
                      <strong>{b.name}</strong>
                      <span className="muted">{b.updatedAt}</span>
                    </div>
                    <button
                      className="btn-primary small"
                      onClick={() => handleLoadBoard(b.id)}
                      title="Load board"
                      aria-label="Load board"
                    >
                      📂
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}

      <p className="hint-bar">Hold Space to pan · Double-click sticky to edit · Ctrl+Z undo</p>
    </div>
  );
}
