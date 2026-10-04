/**
 * TVUP Alert Worker bootstrap v3.2.2
 * Loads last good full worker, then patches permanent symbol map (BANK→BANKEX, all indices, BSE master).
 */
const https = require("https");
const fs = require("fs");
const path = require("path");

const SRC_URL =
  "https://raw.githubusercontent.com/vmali9613-pixel/tvup-alert-worker-upstox/50f6f7c35f6d67ac664bf6dedc9c890b94d6fcaa/index.js";

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return get(res.headers.location).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          reject(new Error("HTTP " + res.statusCode + " fetching worker source"));
          return;
        }
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

const INDEX_PATCH = `
const INDEX_UPSTOX = {
  NIFTY: "NSE_INDEX|Nifty 50", NIFTY50: "NSE_INDEX|Nifty 50",
  BANKNIFTY: "NSE_INDEX|Nifty Bank", NIFTYBANK: "NSE_INDEX|Nifty Bank",
  FINNIFTY: "NSE_INDEX|Nifty Fin Service", CNXFINANCE: "NSE_INDEX|Nifty Fin Service",
  NIFTYNXT50: "NSE_INDEX|Nifty Next 50", NIFTYJR: "NSE_INDEX|Nifty Next 50", JUNIOR: "NSE_INDEX|Nifty Next 50",
  NIFTY100: "NSE_INDEX|Nifty 100", CNX100: "NSE_INDEX|Nifty 100",
  NIFTY200: "NSE_INDEX|Nifty 200", CNX200: "NSE_INDEX|Nifty 200",
  NIFTY500: "NSE_INDEX|Nifty 500", CNX500: "NSE_INDEX|Nifty 500",
  MIDCPNIFTY: "NSE_INDEX|NIFTY MID SELECT", NIFTYMIDSELECT: "NSE_INDEX|NIFTY MID SELECT", NIFTY_MID_SELECT: "NSE_INDEX|NIFTY MID SELECT",
  CNXMIDCAP: "NSE_INDEX|NIFTY MIDCAP 100", NIFTYMIDCAP100: "NSE_INDEX|NIFTY MIDCAP 100", MIDCAP100: "NSE_INDEX|NIFTY MIDCAP 100",
  NIFTYMIDCAP50: "NSE_INDEX|Nifty Midcap 50", MIDCAP50: "NSE_INDEX|Nifty Midcap 50",
  NIFTYMIDCAP150: "NSE_INDEX|NIFTY MIDCAP 150", MIDCAP150: "NSE_INDEX|NIFTY MIDCAP 150",
  CNXSMALLCAP: "NSE_INDEX|NIFTY SMLCAP 100", NIFTYSMLCAP100: "NSE_INDEX|NIFTY SMLCAP 100", SMALLCAP100: "NSE_INDEX|NIFTY SMLCAP 100", SMLCAP100: "NSE_INDEX|NIFTY SMLCAP 100",
  NIFTYSMLCAP250: "NSE_INDEX|NIFTY SMLCAP 250", SMALLCAP250: "NSE_INDEX|NIFTY SMLCAP 250", SMLCAP250: "NSE_INDEX|NIFTY SMLCAP 250",
  NIFTYSMLCAP50: "NSE_INDEX|NIFTY SMLCAP 50", SMALLCAP50: "NSE_INDEX|NIFTY SMLCAP 50", SMLCAP50: "NSE_INDEX|NIFTY SMLCAP 50",
  NIFTYMIDSML400: "NSE_INDEX|NIFTY MIDSML 400", MIDSML400: "NSE_INDEX|NIFTY MIDSML 400",
  NIFTY_SMALLCAP_500: "NSE_INDEX|Nifty Smallcap 500", NIFTYSMLCAP500: "NSE_INDEX|Nifty Smallcap 500", SMALLCAP500: "NSE_INDEX|Nifty Smallcap 500", SMLCAP500: "NSE_INDEX|Nifty Smallcap 500",
  CNXIT: "NSE_INDEX|Nifty IT", NIFTYIT: "NSE_INDEX|Nifty IT",
  CNXAUTO: "NSE_INDEX|Nifty Auto", NIFTYAUTO: "NSE_INDEX|Nifty Auto",
  CNXFMCG: "NSE_INDEX|Nifty FMCG", NIFTYFMCG: "NSE_INDEX|Nifty FMCG",
  CNXPHARMA: "NSE_INDEX|Nifty Pharma", NIFTYPHARMA: "NSE_INDEX|Nifty Pharma",
  CNXMETAL: "NSE_INDEX|Nifty Metal", NIFTYMETAL: "NSE_INDEX|Nifty Metal",
  CNXREALTY: "NSE_INDEX|Nifty Realty", NIFTYREALTY: "NSE_INDEX|Nifty Realty",
  CNXENERGY: "NSE_INDEX|Nifty Energy", NIFTYENERGY: "NSE_INDEX|Nifty Energy",
  CNXINFRA: "NSE_INDEX|Nifty Infra", NIFTYINFRA: "NSE_INDEX|Nifty Infra",
  CNXMEDIA: "NSE_INDEX|Nifty Media", NIFTYMEDIA: "NSE_INDEX|Nifty Media",
  CNXPSE: "NSE_INDEX|Nifty PSE", NIFTYPSE: "NSE_INDEX|Nifty PSE",
  CNXPSUBANK: "NSE_INDEX|Nifty PSU Bank", NIFTYPSUBANK: "NSE_INDEX|Nifty PSU Bank",
  NIFTYPVTBANK: "NSE_INDEX|Nifty Pvt Bank", NIFTYPVTBNK: "NSE_INDEX|Nifty Pvt Bank",
  NIFTY_CEMENT: "NSE_INDEX|Nifty Cement", NIFTYCEMENT: "NSE_INDEX|Nifty Cement", CNXCEMENT: "NSE_INDEX|Nifty Cement",
  NIFTY_CHEMICALS: "NSE_INDEX|Nifty Chemicals", NIFTYCHEMICALS: "NSE_INDEX|Nifty Chemicals",
  CNXCONSUMPTION: "NSE_INDEX|Nifty Consumption", NIFTYCONSUMPTION: "NSE_INDEX|Nifty Consumption",
  INDIAVIX: "NSE_INDEX|India VIX", VIX: "NSE_INDEX|India VIX",
  SENSEX: "BSE_INDEX|SENSEX",
  BANKEX: "BSE_INDEX|BANKEX",
  BANK: "BSE_INDEX|BANKEX"
};
`;

(async () => {
  try {
    let src = await get(SRC_URL);

    src = src.replace(/\s*"\\ud83d\\udd52 " \+ istNow\(\);/, "");
    src = src.replace(/\s*"\\ud83d\\udd52 " \+ new Date\(lt\)\.toLocaleString\([^)]*\)/, "");
    src = src.replace(/(\.replace\(\/_\/g, " "\)) \+ "\\n" \+/g, "$1;");
    src = src.replace(/(\.replace\(\/_\/g, " "\)) \+ "\\n"\s*;/g, "$1;");

    src = src.replace(/const INDEX_UPSTOX = \{[\s\S]*?\n\};/, INDEX_PATCH.trim());

    src = src.replace(
      /async function toKey\(sym\) \{[\s\S]*?\n\}/,
      `async function toKey(sym) {
  let s = String(sym || "").toUpperCase().trim();
  if (!s) return "";
  if (VALID_KEY.test(s)) return s;
  if (s.includes(":")) s = s.split(":").pop().trim();
  if (s.includes("|") && !VALID_KEY.test(s)) s = s.split("|").pop().trim();
  const compact = s.replace(/\\s+/g, "");
  if (INDEX_UPSTOX[s]) return INDEX_UPSTOX[s];
  if (INDEX_UPSTOX[compact]) return INDEX_UPSTOX[compact];
  let map = await loadSymbolKeyMap();
  if (!map.has(s) && !map.has(compact) && Date.now() - masterLoadedAt > 10 * 60 * 1000) {
    map = await loadSymbolKeyMap(true);
  }
  if (map.has(s)) return map.get(s);
  if (map.has(compact)) return map.get(compact);
  return "";
}`
    );

    if (!src.includes("BSE.json.gz")) {
      src = src.replace(
        /console\.log\("\[Upstox\] master:", map\.size\);/,
        `try {
        const bseRes = await tfetch("https://assets.upstox.com/market-quote/instruments/exchange/BSE.json.gz", {}, 60000);
        if (bseRes.ok) {
          let bbuf = Buffer.from(await bseRes.arrayBuffer());
          if (bbuf[0] === 0x1f && bbuf[1] === 0x8b) bbuf = zlib.gunzipSync(bbuf);
          const blist = JSON.parse(bbuf.toString("utf8"));
          const brows = Array.isArray(blist) ? blist : (blist.data || []);
          for (const x of brows) {
            const seg = String(x.segment || "");
            if (seg && seg !== "BSE_EQ" && seg !== "BSE_INDEX") continue;
            const sym = String(x.trading_symbol || "").toUpperCase();
            const ik = String(x.instrument_key || "").trim();
            if (sym && ik && !map.has(sym)) map.set(sym, ik);
            const compact = sym.replace(/\\s+/g, "");
            if (compact && !map.has(compact)) map.set(compact, ik);
          }
        }
      } catch (be) { console.warn("[Upstox] BSE master fail", be.message); }
      console.log("[Upstox] master:", map.size);`
      );
    }

    src = src.replace(/const VERSION = "3\\.2\\.0"/, 'const VERSION = "3.2.2"');
    src = src.replace(/const VERSION = "3\\.2\\.1"/, 'const VERSION = "3.2.2"');
    src = src.replace(/Upstox v3\\.2\\.0/, "Upstox v3.2.2");
    src = src.replace(/Upstox v3\\.2\\.1/, "Upstox v3.2.2");

    src = src.replace(
      /if\s*\(\s*require\.main\s*===\s*module\s*\)\s*start\s*\(\s*\)\s*;/,
      "start();"
    );

    const out = path.join(__dirname, "_worker_runtime.js");
    fs.writeFileSync(out, src);
    console.log("[Bootstrap] v3.2.2 symbol-fix ready", src.length, "bytes —", out);
    require(out);
  } catch (e) {
    console.error("[Bootstrap] failed", e);
    const express = require("express");
    const app = express();
    app.get("/", (_req, res) => res.json({ ok: false, error: String(e.message || e) }));
    app.get("/health", (_req, res) => res.send("bootstrap-fail"));
    app.listen(process.env.PORT || 3000);
  }
})();
