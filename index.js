/**
 * Bootstrap: load last good worker into project dir (express works),
 * strip ALL Telegram date/time lines, run as v3.2.1
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

(async () => {
  try {
    let src = await get(SRC_URL);

    // 1) Main alert: remove "🕒 " + istNow();
    src = src.replace(/\s*"\\ud83d\\udd52 " \+ istNow\(\);/, "");
    // 2) Late-delivery alert: remove "🕒 " + new Date(lt).toLocaleString(...)
    src = src.replace(
      /\s*"\\ud83d\\udd52 " \+ new Date\(lt\)\.toLocaleString\([^)]*\)/,
      ""
    );
    // Fix trailing + "\n" + left on Condition lines
    src = src.replace(/(\.replace\(\/_\/g, " "\)) \+ "\\n" \+/g, "$1;");
    // If Condition ends with + "\n"  (no following +) after late strip
    src = src.replace(
      /(\.replace\(\/_\/g, " "\)) \+ "\\n"\s*;/g,
      "$1;"
    );

    src = src.replace(/const VERSION = "3\.2\.0"/, 'const VERSION = "3.2.1"');
    src = src.replace(/Upstox v3\.2\.0/, "Upstox v3.2.1");

    // When required (not as main), still start the server
    src = src.replace(
      /if\s*\(\s*require\.main\s*===\s*module\s*\)\s*start\s*\(\s*\)\s*;/,
      "start();"
    );

    // Write INSIDE project dir so node_modules/express resolves
    const out = path.join(__dirname, "_worker_runtime.js");
    fs.writeFileSync(out, src);
    console.log("[Bootstrap] fixed worker ready", src.length, "bytes —", out);
    require(out);
  } catch (e) {
    console.error("[Bootstrap] failed", e);
    const express = require("express");
    const app = express();
    app.get("/", (_req, res) =>
      res.json({ ok: false, error: String(e.message || e) })
    );
    app.get("/health", (_req, res) => res.send("bootstrap-fail"));
    app.listen(process.env.PORT || 3000);
  }
})();
