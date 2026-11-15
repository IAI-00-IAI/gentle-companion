// E2E probe: raw HTTP over the tunneled stream, via CDP-evaluated page code.
// Usage: node bridge/e2e_probe.mjs <tcAddr> <devicePort>
import { readFile } from "node:fs/promises";

const [addr, port, token = ""] = process.argv.slice(2);
if (!addr || !port) { console.error("usage: node bridge/e2e_probe.mjs <tcAddr> <port>"); process.exit(2); }

// Page-side code, kept as a separate file so C-string escapes stay sane.
const pageCode = await readFile(new URL("./e2e_page_code.js", import.meta.url), "utf8");
const filled = pageCode
  .replace('"__ADDR__"', JSON.stringify(addr))
  .replace('"__PORT__"', JSON.stringify(String(port)))
  .replace('"__TOKEN__"', JSON.stringify(token));

const page = await (await fetch("http://127.0.0.1:9333/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; setTimeout(() => rej(new Error("cdp ws timeout")), 5000); });
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id;
  pending.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params }));
});

await send("Page.enable");
await send("Page.navigate", { url: "http://127.0.0.1:8077/index.html" });
// Wait until the bridge page finished booting (app.js sets these globals)
// instead of a fixed sleep, which is flaky under load.
let ready = false;
for (let i = 0; i < 100 && !ready; i++) {
  await new Promise((r) => setTimeout(r, 100));
  const rr = await send("Runtime.evaluate", { expression: "!!(window.bridge && window.bridge.dial && window.bridgeFetch && window.TunnelWebSocket)", returnByValue: true });
  ready = rr.result?.result?.value === true;
}
if (!ready) { console.error("bridge page never became ready"); process.exit(1); }
const r = await send("Runtime.evaluate", { expression: filled, awaitPromise: true, returnByValue: true });
const v = r.result?.result?.value;
console.log(typeof v === "string" ? v : JSON.stringify(r).slice(0, 400));
process.exit(0);
