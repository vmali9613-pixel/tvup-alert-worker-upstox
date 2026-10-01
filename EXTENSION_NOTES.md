# Chrome extension notes

## v3.0.5
- Sector indices (CNXIT, CNXAUTO, CNXMIDCAP, …) mapped to Upstox `NSE_INDEX|Nifty …` keys
- TradingView chart: try `tv_symbol` (CNX*) then trading symbol
- Default Firestore project: `tvup-watchlist-for-upstox`
- CHG uses Upstox `net_change` (v3.0.4)

## Alerts checklist
1. Extension Settings: Upstox access token
2. Firestore project ID must match Render `FIREBASE_PROJECT_ID` = `tvup-watchlist-for-upstox`
3. Document `tvup/alerts` field `alertsJson` = `{}` (string) until extension writes alerts
4. Render env: UPSTOX_ACCESS_TOKEN, TELEGRAM_*, FIREBASE_*
5. After saving an alert in extension, Render logs should show active count > 0 within ~1 min

Render only runs cloud worker. Install extension ZIP on Chrome for watchlist LTP/CHG/charts.
