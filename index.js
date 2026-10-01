/**
 * TVUP Alert Worker — Upstox edition
 * Deploy as a new Render Web Service from this repo.
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

const INDEX_UPSTOX = {
  NIFTY: "NSE_INDEX|Nifty 50",
  BANKNIFTY: "NSE_INDEX|Nifty Bank",
  FINNIFTY: "NSE_INDEX|Nifty Fin Service",
  NIFTY500: "NSE_INDEX|Nifty 500",
  CNX500: "NSE_INDEX|Nifty 500",
  SENSEX: "BSE_INDEX|SENSEX"
};

function toKey(sym) {
  const s = String(sym || "").toUpperCase().trim();
  if (!s) return "";
  if (s.includes("|")) return s;
  if (INDEX_UPSTOX[s]) return INDEX_UPSTOX[s];
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
    const data = body?.data || {};
    for (const [k, row] of Object.entries(data)) {
      const last = Number(row?.last_price);
      if (Number.isFinite(last)) out[String(k).toUpperCase()] = last;
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
  if (!FB_PROJECT || !FB_KEY) return {};
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
    keyMap[sym] = r.instrumentKey || r.instrument_key || toKey(sym);
  }
  const quotes = await fetchQuotes([...new Set(Object.values(keyMap))]);
  for (const [id, r] of active) {
    const sym = String(r.symbol || "").toUpperCase();
    const key = String(keyMap[sym] || "").toUpperCase();
    const last = quotes[key] || quotes[key.replace("|", ":")] || quotes[sym];
    const target = Number(r.price);
    const prev = LAST_SENT.has(id) ? LAST_SENT.get(id).ltp : NaN;
    const isHit = hit(prev, last, target, r.condition);
    console.log("[Check]", sym, "ltp=", last, "target=", target, "hit=", isHit);
    if (Number.isFinite(last)) LAST_SENT.set(id, { ltp: last });
    if (!isHit) continue;
    if (LAST_SENT.get(id)?.sent) continue;
    const msg =
      "🎯 Price Alert Hit!\n\n" +
      "📈 Symbol: " + sym + "\n" +
      "💰 Price: ₹" + last + "\n" +
      "🎯 Target: ₹" + target + "\n" +
      "⚙️ Condition: " + String(r.condition || "crossing").replace(/_/g, " ");
    await sendTelegram(msg);
    LAST_SENT.set(id, { ltp: last, sent: true });
    console.log("[TRIGGER]", sym, "[Telegram] sent");
  }
}

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "TVUP Alert Worker (Upstox)", intervalMs: INTERVAL_MS });
});

app.listen(process.env.PORT || 3000, () => {
  console.log("TVUP Alert Worker (Upstox) is running!");
  setInterval(() => tick().catch((e) => console.warn(e)), INTERVAL_MS);
  tick().catch(() => {});
});
