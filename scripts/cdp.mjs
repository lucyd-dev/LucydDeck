#!/usr/bin/env node
// Minimal CDP driver for the running Electron renderer.
//
//   CDP_ENDPOINT=http://127.0.0.1:9224 node scripts/cdp.mjs 'return document.title'
//   CDP_ENDPOINT=http://127.0.0.1:9224 node scripts/cdp.mjs @/tmp/check.js
//
// The expression runs inside an async function, so `await` and `return` work.
// See docs/agents/hardware-test.md for the full deck test loop.
import { readFileSync } from "node:fs";

const ENDPOINT = process.env.CDP_ENDPOINT ?? "http://127.0.0.1:9222";

async function pageSocket() {
    const list = await (await fetch(`${ENDPOINT}/json/list`)).json();
    const page = list.find((target) => target.type === "page");
    if (!page) throw new Error("no page target");
    return page.webSocketDebuggerUrl;
}

function connect(url) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        ws.onopen = () => resolve(ws);
        ws.onerror = (event) => reject(new Error(`ws error: ${event?.message ?? "unknown"}`));
    });
}

let nextId = 1;
function call(ws, method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
        const onMessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.id !== id) return;
            ws.removeEventListener("message", onMessage);
            if (message.error) reject(new Error(JSON.stringify(message.error)));
            else resolve(message.result);
        };
        ws.addEventListener("message", onMessage);
        ws.send(JSON.stringify({ id, method, params }));
    });
}

const raw = process.argv.slice(2).join(" ");
const expression = raw.startsWith("@") ? readFileSync(raw.slice(1), "utf8") : raw;
if (!expression) {
    console.error("usage: cdp.mjs '<js expression>' | @file.js");
    process.exit(2);
}

const ws = await connect(await pageSocket());
try {
    const result = await call(ws, "Runtime.evaluate", {
        expression: `(async () => { ${expression} })()`,
        awaitPromise: true,
        returnByValue: true,
    });
    if (result.exceptionDetails) {
        console.error("EXCEPTION", JSON.stringify(result.exceptionDetails, null, 1));
        process.exit(1);
    }
    const value = result.result?.value;
    console.log(typeof value === "string" ? value : JSON.stringify(value, null, 1));
} finally {
    ws.close();
}
