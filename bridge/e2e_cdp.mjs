// E2E via CDP: fresh page, fill tunnel address, dial, HTTP probe, WS test.
// Usage: node bridge/e2e_cdp.mjs <tcAddr> <devicePort> [token]
const [addr, port, token] = process.argv.slice(2);
if (!addr || !port) { console.error("usage: node bridge/e2e_cdp.mjs <tcAddr> <port> [token]"); process.exit(2); }

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
const evalJs = (expression, timeoutMs = 90000) => Promise.race([
  (async () => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error("page exception: " + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).slice(0, 300));
    return r.result?.result?.value;
  })(),
  new Promise((_, rej) => setTimeout(() => rej(new Error("eval timeout " + timeoutMs / 1000 + "s")), timeoutMs)),
]);

await send("Page.enable");
await send("Page.navigate", { url: "http://127.0.0.1:8077/index.html" });
await new Promise((r) => setTimeout(r, 4000));

const boot = await evalJs(`(async () => {
  for (let i = 0; i < 60; i++) {
    if (window.bridge && typeof window.bridge.dial === "function") return "ready";
    await new Promise(r => setTimeout(r, 500));
  }
  return "timeout: " + document.getElementById("status").textContent;
})()`, 40000);
console.log("boot:", boot);
if (boot !== "ready") process.exit(1);

const result = await evalJs(`(async () => {
  document.getElementById("tunnel-addr").value = ${JSON.stringify(addr)};
  document.getElementById("device-port").value = ${JSON.stringify(String(port))};
  document.getElementById("dial-btn").click();
  for (let i = 0; i < 180; i++) {
    const t = document.getElementById("dial-status").textContent;
    if (t && !t.startsWith("Dialing")) return t;
    await new Promise(r => setTimeout(r, 500));
  }
  return "TIMEOUT: " + document.getElementById("dial-status").textContent;
})()`, 120000);
console.log("dial+probe:", result);

if (token) {
  const wsResult = await evalJs(`(async () => {
    document.getElementById("ws-token").value = ${JSON.stringify(token)};
    document.getElementById("ws-btn").click();
    for (let i = 0; i < 180; i++) {
      const t = document.getElementById("ws-status").textContent;
      if (t && !t.startsWith("Opening")) return t;
      await new Promise(r => setTimeout(r, 500));
    }
    return "TIMEOUT: " + document.getElementById("ws-status").textContent;
  })()`, 120000);
  console.log("ws:", wsResult);
}
process.exit(0);
