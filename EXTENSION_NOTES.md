# Chrome extension (not deployed on Render)

Render only runs `index.js` (cloud alerts).

Watchlist LTP / CHG / CHG% runs inside the **Chrome extension**.

## v3.0.4 fix
Upstox full quote uses `net_change` (day change vs previous close).
Older parse only looked for Fyers-style `ch` / `change`, so LAST filled but CHG/CHG% stayed blank — including after market close.

Install the latest extension ZIP on PC (Load unpacked). No Render redeploy needed for this UI fix.

Firestore `tvup/alerts` field `alertsJson` must be string `{}` (not `0`).
