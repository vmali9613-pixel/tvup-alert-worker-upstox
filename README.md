# TVUP Alert Worker (Upstox)

Cloud worker for **TVUP Watchlist for Upstox**.
Do not connect this repo to the old Fyers Render service.

Repo: https://github.com/vmali9613-pixel/tvup-alert-worker-upstox

## Render
- Runtime: Node
- Build: `npm install`
- Start: `node index.js`

## Environment variables
- `UPSTOX_ACCESS_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_API_KEY`
- `INTERVAL_MS` (optional, default 60000)

## Health
`GET /` → `{ ok: true, service: "TVUP Alert Worker (Upstox)" }`

## Firestore
Document: `tvup/alerts` field `alertsJson` (stringified object).
