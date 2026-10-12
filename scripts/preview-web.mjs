import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist/web/", import.meta.url));
const port = Number(process.env.PREVIEW_PORT || 4173);
const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
]);

createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const relativePath = url.pathname === "/" || url.pathname === "/app" || url.pathname === "/app/"
    ? "index.html"
    : url.pathname.replace(/^\/app\//u, "");
  if (!/^(index\.html|styles\.css|app\.js|vendor\/leaflet-1\.9\.4\.(?:css|js)|vendor\/images\/[a-z0-9@.-]+)$/iu.test(relativePath)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const content = await readFile(`${root}${relativePath}`);
    response.writeHead(200, { "content-type": types.get(extname(relativePath)) || "application/octet-stream" });
    response.end(content);
  } catch {
    response.writeHead(404).end();
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Fishner Mini App preview: http://127.0.0.1:${port}/app`);
});
