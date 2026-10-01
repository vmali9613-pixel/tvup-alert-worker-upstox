/**
 * TVUP Alert Worker — Upstox edition v3.0.1
 * Env: UPSTOX_ACCESS_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
 *      FIREBASE_PROJECT_ID, FIREBASE_API_KEY
 */
const express = require("express");
const app = express();
app.use(express.json());

const INTERVAL_MS = Number(process.env.INTERVAL_MS || 60000);
const UPSTOX_TOKEN = String(process.env.UPSTOX_ACCESS_TOKEN || process.env.UPSTOX_API_KEY || "").trim();
const TG_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const TG_CHAT = String(process.env.TELEGRAM_CHAT_ID || "").trim();
const FB_PROJECT = String(process.env.FIREBASE_PROJECT_ID || process.env.FB_PROJECT || "").trim();
const FB_KEY = String(process.env.FIREBASE_API_KEY || process.env.FB_API_KEY || "").trim();

const LAST_SENT = new Map();
let symbolKeyCache = null;

const INDEX_UPSTOX = {
  NIFTY: "NSE_INDEX|Nifty 50",
  NIFTY50: "NSE_INDEX|Nifty 50",
  BANKNIFTY: "NSE_INDEX|Nifty Bank",
  NIFTYBANK: "NSE_INDEX|Nifty Bank",
  FINNIFTY: "NSE_INDEX|Nifty Fin Service",
  NIFTY500: "NSE_INDEX|Nifty 500",
  CNX500: "NSE_INDEX|Nifty 500",
  SENSEX: "BSE_INDEX|SENSEX",
  BANKEX: "BSE_INDEX|BANKEX"
};

async function loadSymbolKeyMap() {
  if (symbolKeyCache) return symbolKeyCache;
  const map = new Map(Object.entries(INDEX_UPSTOX));
  try {
    const url = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz";
    const res = await fetch(url);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      const zlib = require("zlib");
      const text = zlib.gunzipSync(buf).toString("utf8");
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : (parsed.data || []);
      for (const x of list) {
        const sym = String(x.trading_symbol || "").toUpperCase();
        const ik = String(x.instrument_key || "").trim();
        if (sym && ik && !map.has(sym)) map.set(sym, ik);
      }
      console.log("[Upstox] Symbol master loaded:", map.size);
    }
  } catch (e) {
    console.warn("[Upstox] master load failed", e.message);
  }
  symbolKeyCache = map;
  return map;
}

async function toKey(sym) {
  const s = String(sym || "").toUpperCase().trim();
  if (!s) return "";
  if (s.includes("|") && /INE[A-Z0-9]+|_INDEX\|/i.test(s)) return s;
  if (INDEX_UPSTOX[s]) return INDEX_UPSTOX[s];
  const map = await loadSymbolKeyMap();
  if (map.has(s)) return map.get(s);
  if (s.includes("|")) return s;
  return "NSE_EQ|" + s;
}

async function fetchQuotes(keys) {
  const out = {};
  if (!UPSTOX_TOKEN || !keys.length) return out;
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50);
    const q = chunk.map(encodeURIComponent).join(",");
    const url = "https://api.upstox.com/v2/market-quote/quotes?instrument_key=" + q;
    const res = await fetch(url, {
      headers: { Accept: "application/json", Authorization: "Bearer " + UPSTOX_TOKEN }
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn("[Upstox] quote HTTP", res.status, body?.message || body?.errors || "");
      continue;
    }
    const data = body?.data || {};
    for (const [k, row] of Object.entries(data)) {
      const last = Number(row?.last_price);
      if (Number.isFinite(last)) {
        out[String(k).toUpperCase()] = last;
        out[String(k).replace(":", "|").toUpperCase()] = last;
      }
    }
  }
  return out;
}

async function sendTelegram(text) {
  if (!TG_TOKEN || !TG_CHAT) return;
  await fetch("https://api.telegram.org/bot" + encodeURIComponent(TG_TOKEN) + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TG_CHAT, text })
  });
}

function hit(prev, last, target, cond) {
  const c = String(cond || "crossing").toLowerCase();
  if (!Number.isFinite(last) || !Number.isFinite(target)) return false;
  if (c.includes("above") || c === ">") return last >= target && !(Number.isFinite(prev) && prev >= target);
  if (c.includes("below") || c === "<") return last <= target && !(Number.isFinite(prev) && prev <= target);
  return (Number.isFinite(prev) && ((prev < target && last >= target) || (prev > target && last <= target))) || last === target;
}

async function loadAlerts() {
  if (!FB_PROJECT || !FB_KEY) {
    console.warn("[Firestore] Missing FIREBASE_PROJECT_ID or FIREBASE_API_KEY");
    return {};
  }
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents/tvup/alerts?key=${encodeURIComponent(FB_KEY)}`;
    const res = await fetch(url);
    const body = await res.json();
    const raw = body?.fields?.alertsJson?.stringValue;
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    console.warn("[Firestore] load failed", e.message);
    return {};
  }
}

async function tick() {
  console.log("---", new Date().toLocaleTimeString(), "Checking Firestore alerts ---");
  if (!UPSTOX_TOKEN) console.warn("[Upstox] UPSTOX_ACCESS_TOKEN not set");
  const alerts = await loadAlerts();
  const active = Object.entries(alerts).filter(([, r]) => {
    if (!r) return false;
    const st = String(r.status || "active").toLowerCase();
    if (st === "paused" || st === "triggered") return false;
    if (r.armed === false) return false;
    return true;
  });
  console.log("[Firestore] Total active alert(s):", active.length, active.map(([id]) => id));
  if (!active.length) return;
  const keyMap = {};
  for (const [, r] of active) {
    const sym = String(r.symbol || "").toUpperCase();
    keyMap[sym] = r.instrumentKey || r.instrument_key || (await toKey(sym));
  }
  const quotes = await fetchQuotes([...new Set(Object.values(keyMap))]);
  for (const [id, r] of active) {
    const sym = String(r.symbol || "").toUpperCase();
    const key = String(keyMap[sym] || "").toUpperCase();
    const last = quotes[key] || quotes[key.replace("|", ":")] || quotes[sym];
    const target = Number(r.price);
    const prev = LAST_SENT.has(id) ? LAST_SENT.get(id).ltp : NaN;
    const isHit = hit(prev, last, target, r.condition);
    console.log("[Check]", sym, "key=", key, "ltp=", last, "target=", target, "hit=", isHit);
    if (Number.isFinite(last)) LAST_SENT.set(id, { ltp: last, sent: LAST_SENT.get(id)?.sent });
    if (!isHit) continue;
    if (LAST_SENT.get(id)?.sent) continue;
    const msg =
      "\ud83c\udfaf Price Alert Hit!\n\n" +
      "\ud83d\udcc8 Symbol: " + sym + "\n" +
      "\ud83d\udcb0 Price: \u20b9" + last + "\n" +
      "\ud83c\udfaf Target: \u20b9" + target + "\n" +
      "\u2699\ufe0f Condition: " + String(r.condition || "crossing").replace(/_/g, " ");
    await sendTelegram(msg);
    LAST_SENT.set(id, { ltp: last, sent: true });
    console.log("[TRIGGER]", sym, "[Telegram] sent");
  }
}

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "TVUP Alert Worker (Upstox)", version: "3.0.1", intervalMs: INTERVAL_MS });
});

app.listen(process.env.PORT || 3000, () => {
  console.log("TVUP Alert Worker (Upstox) v3.0.1 is running!");
  loadSymbolKeyMap().catch(() => {});
  setInterval(() => tick().catch((e) => console.warn(e)), INTERVAL_MS);
  tick().catch(() => {});
});
