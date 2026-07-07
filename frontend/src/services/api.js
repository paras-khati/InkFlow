const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";

export async function createRoom() {
  const response = await fetch(`${API_BASE}/api/rooms`, { method: "POST" });
  if (!response.ok) throw new Error("Could not create room.");
  return response.json();
}

export async function fetchRoom(roomId) {
  const response = await fetch(`${API_BASE}/api/rooms/${roomId}`);
  if (!response.ok) throw new Error("Room not found.");
  return response.json();
}

export async function fetchBoards() {
  const response = await fetch(`${API_BASE}/api/boards`);
  if (!response.ok) throw new Error("Could not load boards.");
  return response.json();
}

export async function saveBoard(name, elements) {
  const response = await fetch(`${API_BASE}/api/boards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, elements }),
  });
  if (!response.ok) throw new Error("Could not save board.");
  return response.json();
}

export async function updateBoard(id, name, elements) {
  const response = await fetch(`${API_BASE}/api/boards/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, elements }),
  });
  if (!response.ok) throw new Error("Could not update board.");
  return response.json();
}

export async function loadBoard(id) {
  const response = await fetch(`${API_BASE}/api/boards/${id}`);
  if (!response.ok) throw new Error("Board not found.");
  return response.json();
}

export function getSocketUrl() {
  return import.meta.env.VITE_SOCKET_URL || API_BASE;
}
