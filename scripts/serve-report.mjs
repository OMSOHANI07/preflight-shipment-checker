// Serves reports/edge on http://127.0.0.1:4321 so the report's scripts run in a browser preview.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../reports/edge");
const types = { ".html": "text/html; charset=utf-8", ".json": "application/json" };
http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || "/").split("?")[0]).replace(/^\/+/, "") || "Edge_Case_Test_Report.html";
  const file = path.resolve(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end("Not found"); return; }
  res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(Number(process.env.PORT || 4321), "127.0.0.1", () => console.log(`Report at http://127.0.0.1:${process.env.PORT || 4321}/`));
