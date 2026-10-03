/** TEMP STUB - REUPLOAD YOUR index.js FROM LOCAL BACKUP */
const express = require("express");
const app = express();
app.get("/", (_req, res) => res.json({ ok: false, error: "Re-upload index.js from your local backup (v3.2.0). Accidental PLACEHOLDER commit needs restore." }));
app.get("/health", (_req, res) => res.send("need-restore"));
app.listen(process.env.PORT || 3000, () => console.log("STUB - reupload index.js"));
