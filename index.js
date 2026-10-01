/**
 * TVUP Alert Worker — Upstox edition v3.0.6
 * Env: UPSTOX_ACCESS_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
 *      FIREBASE_PROJECT_ID, FIREBASE_API_KEY
 */
const express = require("express");
const app = express();
app.use(express.json());

const INTERVAL_MS = Number(process.env.INTERVAL_MS || 60000);
let UPSTOX_TOKEN = String(process.env.UPSTOX_ACCESS_TOKEN || process.env.UPSTOX_API_KEY || "").trim();
const TG_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const TG_CHAT = String(process.env.TELEGRAM_CHAT_ID || "").trim();
const FB_PROJECT = String(process.env.FIREBASE_PROJECT_ID || process.env.FB_PROJECT || "").trim();
const FB_KEY = String(process.env.FIREBASE_API_KEY || process.env.FB_API_KEY || "").trim();

const LAST_SENT = new Map();
let symbolKeyCache = null;

const INDEX_UPSTOX = {
  NIFTY: "NSE_INDEX|Nifty 50", NIFTY50: "NSE_INDEX|Nifty 50",
  BANKNIFTY: "NSE_INDEX|Nifty Bank", NIFTYBANK: "NSE_INDEX|Nifty Bank",
  FINNIFTY: "NSE_INDEX|Nifty Fin Service", CNXFINANCE: "NSE_INDEX|Nifty Fin Service",
  NIFTY500: "NSE_INDEX|Nifty 500", CNX500: "NSE_INDEX|Nifty 500",
  NIFTY100: "NSE_INDEX|Nifty 100", CNX100: "NSE_INDEX|Nifty 100",
  NIFTY200: "NSE_INDEX|Nifty 200", CNX200: "NSE_INDEX|Nifty 200",
  CNXMIDCAP: "NSE_INDEX|Nifty Midcap 100", CNXSMALLCAP: "NSE_INDEX|Nifty Smallcap 100",
  CNXIT: "NSE_INDEX|Nifty IT", CNXAUTO: "NSE_INDEX|Nifty Auto",
  CNXFMCG: "NSE_INDEX|Nifty FMCG", CNXPHARMA: "NSE_INDEX|Nifty Pharma",
  CNXMETAL: "NSE_INDEX|Nifty Metal", CNXREALTY: "NSE_INDEX|Nifty Realty",
  CNXENERGY: "NSE_INDEX|Nifty Energy", CNXINFRA: "NSE_INDEX|Nifty Infra",
  INDIAVIX: "NSE_INDEX|India VIX",
  SENSEX: "BSE_INDEX|SENSEX", BANKEX: "BSE_INDEX|BANKEX"
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

function indexQuote(quotes, key) {
  if (!key) return undefined;
  const k = String(key).toUpperCase();
  if (Number.isFinite(quotes[k])) return quotes[k];
  const pipe = k.replace(/:/g, "|");
  const colon = k.replace(/\|/g, ":");
  if (Number.isFinite(quotes[pipe])) return quotes[pipe];
  if (Number.isFinite(quotes[colon])) return quotes[colon];
  const isin = (pipe.split("|")[1] || colon.split(":")[1] || "").toUpperCase();
  if (isin && Number.isFinite(quotes[isin])) return quotes[isin];
  if (isin && Number.isFinite(quotes["NSE_EQ|" + isin])) return quotes["NSE_EQ|" + isin];
  if (isin && Number.isFinite(quotes["NSE_EQ:" + isin])) return quotes["NSE_EQ:" + isin];
  return undefined;
}

async function fetchQuotes(keys, token) {
  const out = {};
  const tok = token || UPSTOX_TOKEN;
  if (!tok || !keys.length) {
    console.warn("[Upstox] No token or no keys for quote fetch");
    return out;
  }
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50);
    const q = chunk.map(encodeURIComponent).join(",");
    const url = "https://api.upstox.com/v2/market-quote/quotes?instrument_key=" + q;
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", Authorization: "Bearer " + tok }
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.warn("[Upstox] quote HTTP", res.status, JSON.stringify(body).slice(0, 200));
        if (res.status === 401) console.warn("[Upstox] TOKEN INVALID — set UPSTOX_ACCESS_TOKEN on Render");
        continue;
      }
      const data = body?.data || {};
      let n = 0;
      for (const [k, row] of Object.entries(data)) {
        const last = Number(row?.last_price);
        if (!Number.isFinite(last)) continue;
        n++;
        const ku = String(k).toUpperCase();
        out[ku] = last;
        out[ku.replace(/:/g, "|")] = last;
        out[ku.replace(/\|/g, ":")] = last;
        const ik = String(row.instrument_token || row.instrument_key || "").toUpperCase();
        if (ik) {
          out[ik] = last;
          out[ik.replace(/:/g, "|")] = last;
          out[ik.replace(/\|/g, ":")] = last;
        }
        const tsym = String(row.symbol || row.trading_symbol || "").toUpperCase();
        if (tsym) out[tsym] = last;
        const isin = (ku.split(":")[1] || ku.split("|")[1] || "").toUpperCase();
        if (isin) out[isin] = last;
      }
      console.log("[Upstox] quote batch ok, instruments:", n);
    } catch (e) {
      console.warn("[Upstox] quote fetch error", e.message);
    }
  }
  return out;
}

async function sendTelegram(text) {
  if (!TG_TOKEN || !TG_CHAT) {
    console.warn("[Telegram] missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
    return;
  }
  try {
    const res = await fetch("https://api.telegram.org/bot" + encodeURIComponent(TG_TOKEN) + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT, text })
    });
    if (!res.ok) console.warn("[Telegram] send failed", res.status, await res.text().catch(() => ""));
    else console.log("[Telegram] sent");
  } catch (e) {
    console.warn("[Telegram] error", e.message);
  }
}

function hit(prev, last, target, cond) {
  const c = String(cond || "crossing").toLowerCase();
  if (!Number.isFinite(last) || !Number.isFinite(target)) return false;
  if (c.includes("above") || c === ">") return last >= target && !(Number.isFinite(prev) && prev >= target);
  if (c.includes("below") || c === "<") return last <= target && !(Number.isFinite(prev) && prev <= target);
  return (Number.isFinite(prev) && ((prev < target && last >= target) || (prev > target && last <= target))) || last === target;
}

async function loadAlertsDoc() {
  if (!FB_PROJECT) {
    console.warn("[Firestore] Missing FIREBASE_PROJECT_ID");
    return { alerts: {}, tokenFromDoc: "" };
  }
  try {
    let url = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents/tvup/alerts`;
    if (FB_KEY && FB_KEY !== "direct") url += `?key=${encodeURIComponent(FB_KEY)}`;
    const res = await fetch(url);
    const body = await res.json();
    if (!res.ok) {
      console.warn("[Firestore] HTTP", res.status, JSON.stringify(body).slice(0, 150));
      return { alerts: {}, tokenFromDoc: "" };
    }
    const fields = body?.fields || {};
    const raw = fields.alertsJson?.stringValue;
    let alerts = {};
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") alerts = parsed;
      } catch (_) {}
    }
    const tokenFromDoc = String(fields.upstoxToken?.stringValue || "").trim();
    return { alerts, tokenFromDoc };
  } catch (e) {
    console.warn("[Firestore] load failed", e.message);
    return { alerts: {}, tokenFromDoc: "" };
  }
}

async function tick() {
  console.log("---", new Date().toLocaleTimeString(), "Checking Firestore alerts ---");
  const { alerts, tokenFromDoc } = await loadAlertsDoc();
  if (tokenFromDoc && tokenFromDoc.length > 20) {
    UPSTOX_TOKEN = tokenFromDoc;
  }
  if (!UPSTOX_TOKEN) {
    console.warn("[Upstox] No access token (env UPSTOX_ACCESS_TOKEN or Firestore upstoxToken)");
  }

  const active = Object.entries(alerts).filter(([, r]) => {
    if (!r) return false;
    const st = String(r.status || "active").toLowerCase();
    if (st === "paused" || st === "triggered" || st === "stopped") return false;
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
  const keys = [...new Set(Object.values(keyMap).filter(Boolean))];
  const quotes = await fetchQuotes(keys, UPSTOX_TOKEN);

  for (const [id, r] of active) {
    const sym = String(r.symbol || "").toUpperCase();
    const key = String(keyMap[sym] || "");
    let last = indexQuote(quotes, key);
    if (!Number.isFinite(last)) last = indexQuote(quotes, sym);
    const target = Number(r.price);
    const prev = LAST_SENT.has(id) ? LAST_SENT.get(id).ltp : NaN;
    const isHit = hit(prev, last, target, r.condition);
    console.log("[Check]", sym, "key=", key, "ltp=", last, "target=", target, "hit=", isHit);
    if (Number.isFinite(last)) {
      const prevSent = LAST_SENT.get(id)?.sent;
      LAST_SENT.set(id, { ltp: last, sent: prevSent });
    }
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
  res.json({
    ok: true,
    service: "TVUP Alert Worker (Upstox)",
    version: "3.0.6",
    intervalMs: INTERVAL_MS,
    hasToken: Boolean(UPSTOX_TOKEN),
    hasTelegram: Boolean(TG_TOKEN && TG_CHAT),
    firebaseProject: FB_PROJECT || null
  });
});

app.listen(process.env.PORT || 3000, () => {
  console.log("TVUP Alert Worker (Upstox) v3.0.6 is running!");
  loadSymbolKeyMap().catch(() => {});
  setInterval(() => tick().catch((e) => console.warn(e)), INTERVAL_MS);
  tick().catch(() => {});
});
