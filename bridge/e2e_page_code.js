// Page-side E2E probe, evaluated by e2e_probe.mjs via CDP. Probes
// /api/context (auth-free JSON on the device surface) and, when a token is
// provided, opens a tunneled WebSocket to /ws/browser.
(async () => {
  const addr = "__ADDR__";
  const port = parseInt("__PORT__", 10);
  const token = "__TOKEN__";
  const out = [];
  const t0 = Date.now();
  try {
    // 1. HTTP over the tunnel.
    const resp = await window.bridgeFetch(addr, port, "GET", "/api/context");
    const body = resp.bodyJson();
    out.push("HTTP " + resp.status + " remote=" + body.remote + " version=" + (body.version || "?") + " in " + (Date.now() - t0) + "ms");

    if (token) {
      // 3. WebSocket over the tunnel via the bridge shim.
      const conn = await window.bridge.dial(addr, port);
      const ws = new window.TunnelWebSocket(conn, "/ws/browser", {
        protocols: ["pi-companion", "token." + token],
        origin: "http://192.168.2.20:43722",
      });
      const wsResult = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve("WS timeout (no open/frame in 30s)"), 30000);
        ws.onopen = () => {};
        ws.onmessage = (e) => {
          clearTimeout(timer);
          const preview = typeof e.data === "string" ? e.data.slice(0, 80) : e.data.byteLength + " bytes";
          resolve("WS-OK first frame: " + preview);
          try { ws.close(); } catch {}
        };
        ws.onerror = (e) => { clearTimeout(timer); resolve("WS error event" + (e && e.message ? ": " + e.message : "")); };
        ws.onclose = (e) => { clearTimeout(timer); resolve("WS closed code=" + e.code); };
      });
      out.push(wsResult);
    }
    return out.join(" || ");
  } catch (e) {
    return "FAIL in " + (Date.now() - t0) + "ms: " + e.message;
  }
})()
