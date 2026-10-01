# TVUP Alert Worker (Upstox) v3.0.1

https://github.com/vmali9613-pixel/tvup-alert-worker-upstox

## Render
- Build: `npm install`
- Start: `node index.js`

## Env
- UPSTOX_ACCESS_TOKEN
- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHAT_ID
- FIREBASE_PROJECT_ID
- FIREBASE_API_KEY
- INTERVAL_MS (optional)

## Health
GET / → ok + version 3.0.1

Loads Upstox NSE symbol master so alert symbols resolve to real instrument keys (ISIN).
