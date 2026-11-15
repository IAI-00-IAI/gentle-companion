// Page-side E2E probe, evaluated by e2e_probe.mjs via CDP. Probes
// /api/context (auth-free JSON on the device surface) and, when a token is
// provided, opens a tunneled WebSocket to /ws/browser.
(async () => {
  const addr = "__ADDR__";
  const port = parseInt("__PORT__", 10);
  const token = "__TOKEN__";
  const out = [];
  const t0 = Date.now();
  const trace = [];
  const t = () => Date.now() - t0;
  const origDial = window.bridge.dial.bind(window.bridge);
  window.bridge.dial = async (a, p) => {
    trace.push(t() + "ms dial start " + a + ":" + p);
    const c = await origDial(a, p);
    trace.push(t() + "ms dial done");
    return {
      port: c.port,
      read: async () => {
        const chunk = await c.read();
        if (chunk === null) {
          trace.push(t() + "ms read -> EOF");
        } else {
          let hex = "";
          for (let i = 0; i < Math.min(chunk.length, 48); i++) hex += chunk[i].toString(16).padStart(2, "0");
          trace.push(t() + "ms read len=" + chunk.length + " head=" + hex);
        }
        return chunk;
      },
      write: (b) => { trace.push(t() + "ms write len=" + b.length); return c.write(b); },
      closeWrite: () => { trace.push(t() + "ms closeWrite"); return c.closeWrite(); },
      close: () => { trace.push(t() + "ms close"); return c.close(); },
    };
  };
  try {
  // 1. HTTP over the tunnel. A tunnel stream torn down before any response
  // byte arrives (EOF before headers) is retried once: the dial is fresh
  // and the daemon never saw the request.
  let resp;
  for (let attempt = 1; ; attempt++) {
    try {
      resp = await window.bridgeFetch(addr, port, "GET", "/api/context");
      break;
    } catch (err) {
      const sawBytes = trace.some((s) => s.includes("read len="));
      if (attempt >= 2 || sawBytes) throw err;
      trace.push(t() + "ms retry after: " + err.message);
    }
  }
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
    return "FAIL in " + (Date.now() - t0) + "ms: " + e.message + "\nTRACE:\n" + trace.join("\n");
  }
})()
