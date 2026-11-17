// TVUP Alert Worker (Upstox) — no dependencies, Node 18+
// Extension sirf Upstox token Firestore me bhejta hai (tvup/alerts). Worker wahi token use karta hai.
// Render env me sirf Telegram chahiye: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
// (optional) FIREBASE_PROJECT_ID, FIREBASE_API_KEY, UPSTOX_ACCESS_TOKEN (fallback)
const http = require("http");
const zlib = require("zlib");

const PROJECT = (process.env.FIREBASE_PROJECT_ID || "tvup-watchlist-for-upstox").trim();
const FB_KEY = (process.env.FIREBASE_API_KEY || "").trim();
const TG_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const TG_CHAT = (process.env.TELEGRAM_CHAT_ID || "").trim();
const ENV_UPSTOX = (process.env.UPSTOX_ACCESS_TOKEN || "").trim();
const PORT = Number(process.env.PORT) || 10000;

const DOC_URL = () =>
  `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/tvup/alerts`;
const withKey = (u) => (FB_KEY && FB_KEY !== "direct" ? u + (u.includes("?") ? "&" : "?") + "key=" + encodeURIComponent(FB_KEY) : u);

const prevPx = new Map();      // ruleId -> last price
const sentOnce = new Set();    // "id:lastTriggeredAt" already sent to Telegram
let lastTokenWarn = 0;
let running = false;
let lastRun = { at: 0, msg: "not run yet" };

const log = (...a) => console.log(new Date().toISOString(), ...a);

/* ---------- Telegram ---------- */
async function telegram(text) {
  if (!TG_TOKEN || !TG_CHAT) { log("Telegram env missing"); return false; }
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: TG_CHAT, text: String(text).slice(0, 3500), disable_web_page_preview: true })
      });
      const b = await r.json().catch(() => ({}));
      if (r.ok && b.ok !== false) return true;
      log("Telegram fail", r.status, b.description);
    } catch (e) { log("Telegram error", e.message); }
    await new Promise((r) => setTimeout(r, 700 * (i + 1)));
  }
  return false;
}

/* ---------- Firestore ---------- */
async function readDoc() {
  const r = await fetch(withKey(DOC_URL()), { cache: "no-store" });
  if (!r.ok) throw new Error("Firestore read HTTP " + r.status);
  const j = await r.json();
  const f = j.fields || {};
  let alerts = {};
  try { alerts = JSON.parse(f.alertsJson?.stringValue || "{}") || {}; } catch (_) {}
  return {
    updateTime: j.updateTime,
    token: (f.upstoxToken?.stringValue || "").trim() || ENV_UPSTOX,
    alerts
  };
}

// Sirf alertsJson update hota hai (token / baaki fields safe rehte hain). Conflict hone par re-read + merge.
async function patchRules(patchById) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const cur = await readDoc();
    const alerts = cur.alerts;
    for (const [id, patch] of Object.entries(patchById)) {
      if (alerts[id]) Object.assign(alerts[id], patch);
    }
    let url = DOC_URL() + "?updateMask.fieldPaths=alertsJson&currentDocument.updateTime=" + encodeURIComponent(cur.updateTime);
    url = withKey(url);
    const r = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { alertsJson: { stringValue: JSON.stringify(alerts) } } })
    });
    if (r.ok) return true;
    log("Firestore patch HTTP", r.status, "attempt", attempt + 1);
    await new Promise((x) => setTimeout(x, 400 * (attempt + 1)));
  }
  return false;
}

/* ---------- Upstox keys + LTP ---------- */
const INDEX_KEYS = {
  NIFTY: "NSE_INDEX|Nifty 50", NIFTY50: "NSE_INDEX|Nifty 50",
  BANKNIFTY: "NSE_INDEX|Nifty Bank", NIFTYBANK: "NSE_INDEX|Nifty Bank",
  FINNIFTY: "NSE_INDEX|Nifty Fin Service", CNXFINANCE: "NSE_INDEX|Nifty Fin Service",
  MIDCPNIFTY: "NSE_INDEX|NIFTY MID SELECT", NIFTYMIDSELECT: "NSE_INDEX|NIFTY MID SELECT",
  NIFTYNXT50: "NSE_INDEX|Nifty Next 50", NIFTY500: "NSE_INDEX|Nifty 500", CNX500: "NSE_INDEX|Nifty 500",
  CNXIT: "NSE_INDEX|Nifty IT", CNXAUTO: "NSE_INDEX|Nifty Auto", CNXFMCG: "NSE_INDEX|Nifty FMCG",
  CNXPHARMA: "NSE_INDEX|Nifty Pharma", CNXMETAL: "NSE_INDEX|Nifty Metal", CNXREALTY: "NSE_INDEX|Nifty Realty",
  INDIAVIX: "NSE_INDEX|India VIX", SENSEX: "BSE_INDEX|SENSEX", BANKEX: "BSE_INDEX|BANKEX"
};
let master = null;
let masterAt = 0;
async function loadMaster() {
  if (master && Date.now() - masterAt < 12 * 3600e3) return master;
  const r = await fetch("https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz");
  if (!r.ok) throw new Error("master HTTP " + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  const list = JSON.parse(zlib.gunzipSync(buf).toString("utf8"));
  const m = new Map();
  for (const x of Array.isArray(list) ? list : []) {
    if (x.segment !== "NSE_EQ" && x.segment !== "NSE_INDEX") continue;
    const s = String(x.trading_symbol || "").toUpperCase().trim();
    if (s && x.instrument_key && !m.has(s)) m.set(s, x.instrument_key);
  }
  master = m; masterAt = Date.now();
  log("master loaded", m.size);
  return m;
}
async function keyFor(sym) {
  const s = String(sym || "").toUpperCase().replace(/^(NSE|BSE):/, "").replace(/-(EQ|BE)$/, "").trim();
  if (INDEX_KEYS[s]) return INDEX_KEYS[s];
  const m = await loadMaster();
  return m.get(s) || null;
}
async function fetchLtp(token, symbols) {
  const keyToSym = new Map();
  for (const s of symbols) { const k = await keyFor(s); if (k) keyToSym.set(k.toUpperCase(), s); }
  const out = {};
  const keys = [...keyToSym.keys()];
  const origKey = (u) => [...keyToSym.keys()].find((k) => k === u);
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50);
    const url = "https://api.upstox.com/v2/market-quote/quotes?instrument_key=" + chunk.map(encodeURIComponent).join(",");
    const r = await fetch(url, { headers: { Accept: "application/json", Authorization: "Bearer " + token } });
    if (r.status === 401) { const e = new Error("UPSTOX_401"); e.code = 401; throw e; }
    if (!r.ok) { log("Upstox HTTP", r.status); continue; }
    const j = await r.json().catch(() => ({}));
    for (const [k, row] of Object.entries(j.data || {})) {
      const last = Number(row?.last_price);
      if (!Number.isFinite(last)) continue;
      const tok = String(row?.instrument_token || "").toUpperCase();
      const sym = keyToSym.get(tok) || keyToSym.get(k.replace(":", "|").toUpperCase());
      if (sym) out[sym] = last;
    }
  }
  return out;
}

/* ---------- alert logic (extension jaisa hi) ---------- */
function normCond(c) {
  const v = String(c || "").toLowerCase();
  if (v === "below" || v === "crossing_down" || v === "down") return "crossing_down";
  if (v === "above" || v === "crossing_up" || v === "up") return "crossing_up";
  return "crossing";
}
function hit(prev, last, target, cond) {
  const eps = Math.max(0.10, Math.abs(target) * 0.0002);
  if (!Number.isFinite(prev)) return false;
  if (cond === "crossing_up") return prev < target - eps && last >= target - eps;
  if (cond === "crossing_down") return prev > target + eps && last <= target + eps;
  return (prev < target - eps && last >= target - eps) || (prev > target + eps && last <= target + eps);
}
const fmt = (n) => Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const msgFor = (sym, price, target, cond) =>
  "🎯 Price Alert Hit!\n\n" + "📈 Symbol: " + sym + "\n" + "💰 Price: ₹" + fmt(price) + "\n" +
  "🎯 Target: ₹" + fmt(target) + "\n" + "⚙️ Condition: " + String(cond).replace(/_/g, " ");

async function cycle(reason) {
  if (running) return;
  running = true;
  try {
    const { token, alerts } = await readDoc();
    const rules = Object.entries(alerts).filter(([, r]) => r && typeof r === "object");
    const active = rules.filter(([, r]) => r.status !== "paused" && r.status !== "triggered" && r.status !== "stopped" && r.armed !== false);
    const needTg = rules.filter(([, r]) => r.status === "triggered" && r.lastTriggeredAt && !r.cloudTelegramSentAt);

    // 1) Extension ne trigger kiya, Telegram baaki hai
    const patches = {};
    for (const [aid, r] of needTg) {
      const id = String(r.id || aid);
      const key = id + ":" + r.lastTriggeredAt;
      if (sentOnce.has(key)) continue;
      const ok = await telegram(msgFor(String(r.symbol || aid).toUpperCase(), r.triggerPrice ?? r.price, r.price, normCond(r.condition)));
      if (ok) { sentOnce.add(key); patches[id] = { cloudTelegramSentAt: Date.now() }; }
    }

    // 2) Active alerts check
    if (active.length) {
      if (!token) throw new Error("Upstox token missing (extension Settings me daalo)");
      const syms = [...new Set(active.map(([a, r]) => String(r.symbol || a).toUpperCase()))];
      const ltp = await fetchLtp(token, syms);
      for (const [aid, r] of active) {
        const id = String(r.id || aid);
        const sym = String(r.symbol || aid).toUpperCase();
        const last = ltp[sym];
        if (!Number.isFinite(last)) continue;
        const target = Number(r.price);
        const cond = normCond(r.condition);
        let prev = prevPx.get(id);
        if (!Number.isFinite(prev)) prev = Number(r.armPrice);
        prevPx.set(id, last);
        if (!hit(prev, last, target, cond)) continue;
        const now = Date.now();
        const key = id + ":" + now;
        const ok = await telegram(msgFor(sym, last, target, cond));
        sentOnce.add(key);
        patches[id] = {
          status: "triggered", armed: false, lastTriggeredAt: now, triggerPrice: last,
          ...(ok ? { cloudTelegramSentAt: now } : {})
        };
        log("TRIGGERED", sym, cond, target, "ltp", last, "tg", ok);
      }
    }

    if (Object.keys(patches).length) await patchRules(patches);
    lastRun = { at: Date.now(), msg: `ok (${reason}) active=${active.length} sent=${Object.keys(patches).length}` };
  } catch (e) {
    lastRun = { at: Date.now(), msg: "error: " + e.message };
    log("cycle error", e.message);
    if ((e.code === 401 || e.message === "UPSTOX_401") && Date.now() - lastTokenWarn > 6 * 3600e3) {
      lastTokenWarn = Date.now();
      await telegram("⚠️ Upstox token expire ho gaya. Extension Settings me naya token paste karke Save karo, tab alerts chalu honge.");
    }
  } finally { running = false; }
}

/* ---------- timers ---------- */
function marketOpen() {
  const ist = new Date(Date.now() + 5.5 * 3600e3);
  const d = ist.getUTCDay(), m = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return d >= 1 && d <= 5 && m >= 9 * 60 && m <= 15 * 60 + 35;
}
setInterval(() => { if (marketOpen()) cycle("timer"); }, 20000);

/* ---------- HTTP (cron ping) — hamesha 200, rate-limit nahi ---------- */
http.createServer((req, res) => {
  cycle("ping");
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("TVUP worker OK | last: " + lastRun.msg + " | " + (lastRun.at ? new Date(lastRun.at).toISOString() : "-"));
}).listen(PORT, () => log("listening", PORT));
