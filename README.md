# InkFlow

**Where ideas stream together** — a real-time collaborative whiteboard.

Made by **Paras Khati**.

**Repository:** [github.com/paras-khati/InkFlow](https://github.com/paras-khati/InkFlow)

## What makes InkFlow unique

- **Instant room codes** — no signup; share a 6-character code or URL
- **Live collaborator cursors** with color-coded names
- **Sticky notes** for quick brainstorming
- **Board gallery** — save and reload named boards (SQLite)
- **Aurora glass UI** — dark theme with pan/zoom infinite canvas
- **Export to PNG** — download your work anytime

## Stack

| Layer    | Tech                          |
|----------|-------------------------------|
| Frontend | React 19, Vite, perfect-freehand |
| Backend  | Express, Socket.io, SQLite    |

## Quick start

### 0. Environment (optional)

Copy `.env.example` to configure ports and API URLs for deployment:

```bash
cp .env.example .env
```

For frontend local overrides, create `frontend/.env.local` using the `VITE_*` values from `.env.example`.

### 1. Backend

```bash
cd backend
npm install
npm run dev
```

Runs at `http://localhost:4000`.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Opens at `http://localhost:5173`.

### 3. Use InkFlow

1. Enter your display name (optional)
2. Click **Create New Room** or join with a room code
3. Share the URL — collaborators join instantly
4. Draw, add sticky notes, save boards, export PNG

## Tools

| Tool       | Description              |
|------------|--------------------------|
| Pen        | Freehand drawing         |
| Eraser     | Erase strokes            |
| Shapes     | Rectangle, ellipse, line, arrow |
| Text       | Click to place text      |
| Sticky     | Colorful sticky notes    |
| Select     | Select elements          |

**Shortcuts:** Hold `Space` to pan · `Ctrl+Z` undo · `Ctrl+Shift+Z` redo

## API

| Method | Endpoint           | Description        |
|--------|--------------------|--------------------|
| POST   | `/api/rooms`       | Create room        |
| GET    | `/api/rooms/:id`   | Get room state     |
| GET    | `/api/boards`      | List saved boards  |
| POST   | `/api/boards`      | Save board         |
| GET    | `/api/boards/:id`  | Load board         |

Real-time sync uses Socket.io events: `joinRoom`, `drawingUpdate`, `cursorMove`.

## Environment variables

| Variable           | Default                  |
|--------------------|--------------------------|
| `PORT`             | `4000`                   |
| `FRONTEND_ORIGIN`  | `http://localhost:5173`  |
| `VITE_API_URL`     | `http://localhost:4000`  |
| `VITE_SOCKET_URL`  | same as API URL          |

## Author

**Paras Khati**

## License

MIT — see [LICENSE](LICENSE).
