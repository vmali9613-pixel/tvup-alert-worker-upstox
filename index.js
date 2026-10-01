/**
 * TVUP Alert Worker — Upstox v3.0.9 (reliable same-LTP + batch trigger)
 * Env: UPSTOX_ACCESS_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
 *      FIREBASE_PROJECT_ID, FIREBASE_API_KEY, INTERVAL_MS (optional)
 */
const express = require("express");
const app = express();
app.use(express.json());

const INTERVAL_MS = Number(process.env.INTERVAL_MS || 20000);
let UPSTOX_TOKEN = String(process.env.UPSTOX_ACCESS_TOKEN || process.env.UPSTOX_API_KEY || "").trim();
const TG_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const TG_CHAT = String(process.env.TELEGRAM_CHAT_ID || "").trim();
const FB_PROJECT = String(process.env.FIREBASE_PROJECT_ID || process.env.FB_PROJECT || "").trim();
const FB_KEY = String(process.env.FIREBASE_API_KEY || process.env.FB_API_KEY || "").trim();

const MEM = new Map();
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
      const text = require("zlib").gunzipSync(buf).toString("utf8");
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : (parsed.data || []);
      for (const x of list) {
        const sym = String(x.trading_symbol || "").toUpperCase();
        const ik = String(x.instrument_key || "").trim();
        if (sym && ik && !map.has(sym)) map.set(sym, ik);
      }
      console.log("[Upstox] master:", map.size);
    }
  } catch (e) {
    console.warn("[Upstox] master fail", e.message);
  }
  symbolKeyCache = map;
  return map;
}

async function toKey(sym) {
  const s = String(sym || "").toUpperCase().trim();
  if (!s) return "";
  if (/^(NSE|BSE)_INDEX\|/i.test(s)) return s;
  if (/^(NSE|BSE)_EQ\|INE/i.test(s)) return s;
  if (INDEX_UPSTOX[s]) return INDEX_UPSTOX[s];
  const map = await loadSymbolKeyMap();
  if (map.has(s)) return map.get(s);
  if (s.includes("|")) return s;
  return "NSE_EQ|" + s;
}

function pickLtp(quotes, key, sym) {
  const tryKeys = [];
  const push = (k) => { if (k) tryKeys.push(String(k).toUpperCase()); };
  push(key);
  if (key) {
    push(key.replace(/:/g, "|"));
    push(key.replace(/\|/g, ":"));
    const part = key.split(/[|:]/).pop();
    push(part);
    push("NSE_EQ|" + part);
    push("NSE_EQ:" + part);
  }
  push(sym);
  for (const k of tryKeys) {
    if (Number.isFinite(quotes[k])) return quotes[k];
  }
  return undefined;
}

async function fetchQuotes(keys, token) {
  const out = {};
  const tok = token || UPSTOX_TOKEN;
  if (!tok || !keys.length) {
    console.warn("[Upstox] skip quotes — token?", !!tok, "keys", keys.length);
    return out;
  }
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50);
    const url = "https://api.upstox.com/v2/market-quote/quotes?instrument_key=" +
      chunk.map(encodeURIComponent).join(",");
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", Authorization: "Bearer " + tok }
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.warn("[Upstox] HTTP", res.status, JSON.stringify(body).slice(0, 180));
        continue;
      }
      let n = 0;
      for (const [k, row] of Object.entries(body.data || {})) {
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
        }
        const tsym = String(row.symbol || "").toUpperCase();
        if (tsym) out[tsym] = last;
        const isin = (ku.split(":")[1] || ku.split("|")[1] || "").toUpperCase();
        if (isin) out[isin] = last;
      }
      console.log("[Upstox] quotes ok:", n);
    } catch (e) {
      console.warn("[Upstox] fetch err", e.message);
    }
  }
  return out;
}

async function sendTelegram(text) {
  if (!TG_TOKEN || !TG_CHAT) {
    console.warn("[Telegram] missing credentials");
    return false;
  }
  try {
    const res = await fetch(
      "https://api.telegram.org/bot" + encodeURIComponent(TG_TOKEN) + "/sendMessage",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: TG_CHAT, text })
      }
    );
    if (!res.ok) {
      console.warn("[Telegram] fail", res.status, await res.text().catch(() => ""));
      return false;
    }
    console.log("[Telegram] ok");
    return true;
  } catch (e) {
    console.warn("[Telegram] err", e.message);
    return false;
  }
}

function shouldFire(prev, last, target, cond) {
  if (!Number.isFinite(last) || !Number.isFinite(target)) return false;
  const eps = Math.max(0.10, Math.abs(target) * 0.0002);
  if (Math.abs(last - target) <= eps) return true;

  const c = String(cond || "crossing").toLowerCase().replace(/\s+/g, "_");

  if (c.includes("up") || c === "above" || c === ">") {
    if (!Number.isFinite(prev)) return last >= target - eps;
    return prev < target - eps && last >= target - eps;
  }
  if (c.includes("down") || c === "below" || c === "<") {
    if (!Number.isFinite(prev)) return last <= target + eps;
    return prev > target + eps && last <= target + eps;
  }
  if (!Number.isFinite(prev)) return false;
  return (prev < target - eps && last >= target - eps) ||
         (prev > target + eps && last <= target + eps);
}

async function loadDoc() {
  if (!FB_PROJECT) {
    console.warn("[FS] no FIREBASE_PROJECT_ID");
    return { alerts: {}, token: "" };
  }
  try {
    let url = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents/tvup/alerts`;
    if (FB_KEY && FB_KEY !== "direct") url += `?key=${encodeURIComponent(FB_KEY)}`;
    const res = await fetch(url);
    const body = await res.json();
    if (!res.ok) {
      console.warn("[FS] HTTP", res.status, JSON.stringify(body).slice(0, 120));
      return { alerts: {}, token: "" };
    }
    const fields = body.fields || {};
    let alerts = {};
    try {
      const raw = fields.alertsJson?.stringValue;
      if (raw) {
        const p = JSON.parse(raw);
        if (p && typeof p === "object") alerts = p;
      }
    } catch (_) {}
    const token = String(fields.upstoxToken?.stringValue || "").trim();
    return { alerts, token };
  } catch (e) {
    console.warn("[FS] load", e.message);
    return { alerts: {}, token: "" };
  }
}

async function saveAlerts(alerts) {
  if (!FB_PROJECT) return;
  try {
    let url = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents/tvup/alerts?updateMask.fieldPaths=alertsJson&updateMask.fieldPaths=updatedAt`;
    if (FB_KEY && FB_KEY !== "direct") url += `&key=${encodeURIComponent(FB_KEY)}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          alertsJson: { stringValue: JSON.stringify(alerts) },
          updatedAt: { integerValue: String(Date.now()) }
        }
      })
    });
    if (!res.ok) console.warn("[FS] save", res.status, await res.text().catch(() => ""));
    else console.log("[FS] saved", Object.keys(alerts).length, "alerts");
  } catch (e) {
    console.warn("[FS] save err", e.message);
  }
}

function isActive(r) {
  if (!r || typeof r !== "object") return false;
  const st = String(r.status || "active").toLowerCase();
  if (st === "paused" || st === "triggered" || st === "stopped") return false;
  if (r.armed === false) return false;
  return true;
}

async function tick() {
  const t0 = Date.now();
  console.log("---", new Date().toLocaleTimeString(), "tick ---");
  const { alerts, token } = await loadDoc();
  if (token && token.length > 20) UPSTOX_TOKEN = token;
  if (!UPSTOX_TOKEN) console.warn("[Upstox] NO TOKEN");

  const active = Object.entries(alerts).filter(([, r]) => isActive(r));
  console.log("[FS] active:", active.length, active.map(([id]) => id));
  if (!active.length) return;

  const keyMap = {};
  for (const [, r] of active) {
    const sym = String(r.symbol || "").toUpperCase();
    if (!sym) continue;
    keyMap[sym] = r.instrumentKey || r.instrument_key || (await toKey(sym));
  }
  const keys = [...new Set(Object.values(keyMap).filter(Boolean))];
  const quotes = await fetchQuotes(keys, UPSTOX_TOKEN);

  const toTrigger = [];
  for (const [id, r] of active) {
    const sym = String(r.symbol || "").toUpperCase();
    const key = keyMap[sym] || "";
    const last = pickLtp(quotes, key, sym);
    const target = Number(r.price);
    const mem = MEM.get(id);
    const prev = mem && Number.isFinite(mem.ltp) ? mem.ltp : NaN;
    const fire = shouldFire(prev, last, target, r.condition);
    console.log("[Check]", id.slice(0, 12), sym, "ltp=", last, "tgt=", target, "fire=", fire);

    if (Number.isFinite(last)) {
      MEM.set(id, { ltp: last, sentAt: mem?.sentAt || 0 });
    }
    if (!fire) continue;
    if (mem?.sentAt && Date.now() - mem.sentAt < 5 * 60 * 1000) {
      console.log("[Skip] already sent recently", id);
      continue;
    }
    if (r.lastTriggeredAt && Date.now() - Number(r.lastTriggeredAt) < 5 * 60 * 1000) {
      console.log("[Skip] FS lastTriggered recent", id);
      continue;
    }
    toTrigger.push({ id, r, sym, last, target });
  }

  if (!toTrigger.length) {
    console.log("[Done] no triggers", Date.now() - t0, "ms");
    return;
  }

  console.log("[Fire]", toTrigger.length, "alerts");
  for (const item of toTrigger) {
    const msg =
      "\ud83c\udfaf Price Alert Hit!\n\n" +
      "\ud83d\udcc8 Symbol: " + item.sym + "\n" +
      "\ud83d\udcb0 Price: \u20b9" + item.last + "\n" +
      "\ud83c\udfaf Target: \u20b9" + item.target + "\n" +
      "\u2699\ufe0f Condition: " + String(item.r.condition || "crossing").replace(/_/g, " ");
    const ok = await sendTelegram(msg);
    MEM.set(item.id, { ltp: item.last, sentAt: Date.now() });
    item.r.status = "triggered";
    item.r.armed = false;
    item.r.lastTriggeredAt = Date.now();
    alerts[item.id] = item.r;
    console.log(ok ? "[TRIGGER ok]" : "[TRIGGER tg-fail]", item.sym);
    await new Promise((r) => setTimeout(r, 400));
  }
  await saveAlerts(alerts);
  console.log("[Done] triggers flushed", Date.now() - t0, "ms");
}

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "TVUP Alert Worker (Upstox)",
    version: "3.0.9",
    intervalMs: INTERVAL_MS,
    hasToken: Boolean(UPSTOX_TOKEN),
    hasTelegram: Boolean(TG_TOKEN && TG_CHAT),
    firebaseProject: FB_PROJECT || null
  });
});

app.get("/tick", async (_req, res) => {
  try {
    await tick();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("TVUP Alert Worker (Upstox) v3.0.9 running, interval", INTERVAL_MS);
  loadSymbolKeyMap().catch(() => {});
  setInterval(() => tick().catch((e) => console.warn(e)), INTERVAL_MS);
  setTimeout(() => tick().catch(() => {}), 2000);
});
