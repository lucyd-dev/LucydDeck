// Tiny static server for the throwaway inspector prototype.
// Run `npm run prototype:panel`, then open the printed URL.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 4173);
const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
};

createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const requested = url.pathname === "/" ? "one-action.html" : url.pathname;
    const file = normalize(join(root, decodeURIComponent(requested)));
    if (!file.startsWith(root)) {
        response.statusCode = 403;
        response.end("Forbidden");
        return;
    }
    try {
        const data = await readFile(file);
        response.setHeader("content-type", types[extname(file)] ?? "application/octet-stream");
        response.end(data);
    } catch {
        response.statusCode = 404;
        response.end("Not found");
    }
}).listen(port, () => {
    console.log(`Inspector prototype: http://localhost:${port}/one-action.html`);
});
