# TVUP Alert Worker (Upstox)

Cloud price-alert worker for **Render**.
Reads alerts from **Firestore**, prices from **Upstox**, sends **Telegram**.

## Not the Chrome extension
Extension repo is separate: [tvup-watchlist-upstox](https://github.com/vmali9613-pixel/tvup-watchlist-upstox)

## Render setup
1. New **Web Service** → connect this repo
2. Runtime: **Node**
3. Build: `npm install`
4. Start: `node index.js` (or `npm start`)
5. Environment variables (see below)
6. Deploy → open service URL → should show JSON with `"ok":true`

## Environment variables
| Key | Required | Example |
|-----|----------|---------|
| `UPSTOX_ACCESS_TOKEN` | Yes | your Upstox access token |
| `TELEGRAM_BOT_TOKEN` | Yes | from @BotFather |
| `TELEGRAM_CHAT_ID` | Yes | your chat id |
| `FIREBASE_PROJECT_ID` | Yes | e.g. `tvup-watchlist-for-upstox` |
| `FIREBASE_API_KEY` | Yes | Firebase web API key |
| `INTERVAL_MS` | No | `20000` (default) |
| `ALERT_MODE` | No | `once` (default) or `repeat` |

## Test endpoints
- `/` — service info
- `/health` — ok
- `/status` — live status
- `/test-telegram` — send test Telegram
- `/tick` — force one alert check

## Cron (free tier wake-up)
Free Render sleeps. Use [cron-job.org](https://cron-job.org) every 5–10 min:
`GET https://YOUR-SERVICE.onrender.com/health`
