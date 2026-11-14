// Page-side E2E probe, evaluated by e2e_probe.mjs via CDP.
(async () => {
  const addr = __ADDR__;
  const port = parseInt(__PORT__, 10);
  const t0 = Date.now();
  try {
    const conn = await window.bridge.dial(addr, port);
    const req = new TextEncoder().encode("GET /api/settings HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
    await conn.write(req);
    await conn.closeWrite();
    const chunks = [];
    for (;;) {
      const c = await conn.read();
      if (c === null) break;
      chunks.push(new Uint8Array(c));
    }
    const total = chunks.reduce((n, c) => n + c.byteLength, 0);
    const all = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { all.set(c, off); off += c.byteLength; }
    const text = new TextDecoder().decode(all);
    const status = text.split("\r\n")[0];
    const body = text.slice(text.indexOf("\r\n\r\n") + 4, text.indexOf("\r\n\r\n") + 84);
    return "HTTP-OK in " + (Date.now() - t0) + "ms | " + status + " | body: " + body;
  } catch (e) {
    return "FAIL in " + (Date.now() - t0) + "ms: " + e.message;
  }
})()
