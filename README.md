# TVUP Alert Worker (Upstox) v3.1.0

## Render
- Build: `npm install`
- Start: `node index.js`
- Health Check Path (Render settings): `/health`

## Env
- UPSTOX_ACCESS_TOKEN
- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHAT_ID
- FIREBASE_PROJECT_ID  (= tvup-watchlist-for-upstox)
- FIREBASE_API_KEY
- INTERVAL_MS (optional, default 20000, min 5000)

## Endpoints
- `GET /`        → version + basic info
- `GET /health`  → `ok`
- `GET /status`  → last tick, active alerts, token/Firestore/Telegram status, pending marks
- `GET /tick`    → manual tick (overlap safe)

## Render free plan: sleep problem
Free service 15 min idle ke baad so jati hai. UptimeRobot / cron-job.org se
`https://<your-service>.onrender.com/health` ko har 5 min ping karo (ya paid plan lo).

## v3.1.0 changes
- Overlapping ticks lock (double Telegram nahi)
- Telegram fail => alert ACTIVE rehta hai, auto-retry (pehle lost ho jata tha)
- Firestore save = fresh merge + updateTime precondition (extension ke naye alerts overwrite nahi hote)
- Save fail => pending queue, har tick retry
- Ek galat symbol poora batch fail nahi karta (400 => split & skip)
- Symbol master 6h me refresh (naye IPO), fail par cache nahi hota
- Upstox token expire => Telegram warning; env + Firestore dono token try
- Last price baseline Firestore `tvup/workerState` me (restart ke baad crossing miss nahi). Rules allow nahi karte to auto-disable, worker normal chalta hai.
- Har network call par timeout, watchdog, IST time in message
