// Node test for the bridge WebSocket-over-stream shim (bridge/ws.js).
// Run: node bridge/ws_test.mjs   (no dependencies)
//
// Unit tests cover frame encode/decode (masking, ping/pong, close,
// fragmentation) and the handshake helpers. Integration tests run the shim
// against a minimal hand-rolled RFC 6455 server over node:net, faking the
// tailcat conn with the same adapter pattern as http_test.mjs.

import net from "node:net";
import crypto from "node:crypto";
import { TunnelWebSocket, encodeFrame, createFrameParser, computeAccept, sha1 } from "./ws.js";

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`ok - ${name}`);
  } else {
    failures++;
    console.error(`FAIL - ${name}${detail ? `: ${JSON.stringify(detail)}` : ""}`);
  }
}

function utf8(s) { return new TextEncoder().encode(s); }
function decodeUtf8(b) { return new TextDecoder().decode(b); }
function concat(dst, src) {
  const out = new Uint8Array(dst.length + src.length);
  out.set(dst); out.set(src, dst.length);
  return out;
}
const hex = (b) => Buffer.from(b).toString("hex");

// waitFor polls until fn() is true or the timeout elapses.
async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 5));
  }
  return fn();
}

// --- unit: SHA-1 (known vectors from FIPS 180-1 test suite) ---
{
  check("sha1: empty string", hex(sha1(utf8(""))) === "da39a3ee5e6b4b0d3255bfef95601890afd80709");
  check("sha1: abc", hex(sha1(utf8("abc"))) === "a9993e364706816aba3e25717850c26c9cd0d89d");
  check("sha1: 56-byte msg (padding in a fresh block)",
    hex(sha1(utf8("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))) === "84983e441c3bd26ebaae4aa1f95129e5e54670f1");
  check("sha1: 64 x 'a' (padding in its own block)",
    hex(sha1(utf8("a".repeat(64)))) === "0098ba824b5c16427bd7a1122a5a442a25ec644d");
}

// --- unit: Sec-WebSocket-Accept (RFC 6455 section 1.3 example) ---
{
  check("computeAccept: RFC example",
    computeAccept("dGhlIHNhbXBsZSBub25jZQ==") === "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
}

// --- unit: frame encoding, masking on by default ---
{
  const f = encodeFrame(0x1, "hi");
  check("encode text: fin bit set", (f[0] & 0x80) !== 0);
  check("encode text: opcode", (f[0] & 0x0f) === 0x1);
  check("encode text: masked bit set", (f[1] & 0x80) !== 0, "client frames must be masked");
  check("encode text: len 2", (f[1] & 0x7f) === 2);
  check("encode text: total size", f.length === 2 + 4 + 2);

  const frames = createFrameParser().push(f);
  check("roundtrip text: one frame", frames.length === 1);
  check("roundtrip text: payload", decodeUtf8(frames[0].payload) === "hi");
}

// --- unit: extended 16-bit and 64-bit payload lengths ---
{
  const big = new Uint8Array(200).fill(0xab);
  const f16 = encodeFrame(0x2, big);
  check("encode 16-bit len: marker", (f16[1] & 0x7f) === 126);
  check("encode 16-bit len: value", new DataView(f16.buffer).getUint16(2) === 200);
  const back16 = createFrameParser().push(f16);
  check("roundtrip 16-bit len", back16.length === 1 && back16[0].payload.length === 200 && back16[0].payload[199] === 0xab);

  const huge = new Uint8Array(70000).fill(0x5a);
  const f64 = encodeFrame(0x2, huge);
  check("encode 64-bit len: marker", (f64[1] & 0x7f) === 127);
  check("encode 64-bit len: value", Number(new DataView(f64.buffer).getBigUint64(2)) === 70000);
  const back64 = createFrameParser().push(f64);
  check("roundtrip 64-bit len", back64.length === 1 && back64[0].payload.length === 70000 && back64[0].payload[69999] === 0x5a);
}

// --- unit: ping/pong and close frames ---
{
  const ping = createFrameParser().push(encodeFrame(0x9, "ping!"));
  check("ping: opcode + payload", ping[0].opcode === 0x9 && decodeUtf8(ping[0].payload) === "ping!");

  const pong = createFrameParser().push(encodeFrame(0xa, new Uint8Array(0)));
  check("pong: opcode + empty", pong[0].opcode === 0xa && pong[0].payload.length === 0);

  const reason = utf8("going away");
  const closePayload = new Uint8Array(2 + reason.length);
  new DataView(closePayload.buffer).setUint16(0, 1000);
  closePayload.set(reason, 2);
  const close = createFrameParser().push(encodeFrame(0x8, closePayload));
  check("close: opcode", close[0].opcode === 0x8);
  check("close: code", new DataView(close[0].payload.buffer, close[0].payload.byteOffset).getUint16(0) === 1000);
  check("close: reason", decodeUtf8(close[0].payload.subarray(2)) === "going away");
}

// --- unit: fragmentation and split delivery ---
{
  const parser = createFrameParser();
  // One text message split into three frames: first, continuation, final.
  const all = concat(concat(encodeFrame(0x1, "Hel", { fin: false }),
                            encodeFrame(0x0, "lo w", { fin: false })),
                     encodeFrame(0x0, "orld", { fin: true }));
  // Deliver byte-by-byte to prove incremental parsing.
  let frames = [];
  for (const b of all) frames.push(...parser.push(new Uint8Array([b])));
  check("fragmented: three frames decoded", frames.length === 3);
  check("fragmented: fin bits", frames[0].fin === false && frames[1].fin === false && frames[2].fin === true);
  check("fragmented: opcodes", frames[0].opcode === 0x1 && frames[1].opcode === 0x0 && frames[2].opcode === 0x0);
  const joined = frames.reduce((acc, f) => concat(acc, f.payload), new Uint8Array(0));
  check("fragmented: payloads reassemble", decodeUtf8(joined) === "Hello world");

  const two = createFrameParser().push(concat(encodeFrame(0x9, "p"), encodeFrame(0x1, "m")));
  check("coalesced: two frames in one push", two.length === 2 && two[0].opcode === 0x9 && two[1].opcode === 0x1);
}

// --- integration scaffolding ---

// makeConn adapts a node:net Socket to the conn semantics of
// window.bridge.dial (same pattern as http_test.mjs).
const clientConns = new Set();

function makeConn(host, port) {
  const socket = net.connect({ host, port });
  const pending = [];
  let reads = [];
  let eof = false;
  let closed = false;
  socket.on("data", (data) => {
    const chunk = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (reads.length) reads.shift()(chunk);
    else pending.push(chunk);
  });
  socket.on("end", () => { eof = true; while (reads.length) reads.shift()(null); });
  socket.on("error", () => {});
  socket.on("close", () => {
    closed = true; eof = true;
    clientConns.delete(conn);
    while (reads.length) reads.shift()(null);
  });
  const conn = {
    port,
    read() {
      if (pending.length) return Promise.resolve(pending.shift());
      if (eof) return Promise.resolve(null);
      return new Promise((resolve) => reads.push(resolve));
    },
    write(bytes) { socket.write(Buffer.from(bytes)); },
    closeWrite() { socket.end(); },
    close() { if (!closed) socket.destroy(); },
  };
  clientConns.add(conn);
  return conn;
}

// maskBytes applies the XOR mask (verifies client masking round-trips).
function maskBytes(payload, key) {
  const out = new Uint8Array(payload.length);
  for (let i = 0; i < payload.length; i++) out[i] = payload[i] ^ key[i % 4];
  return out;
}

// startWsServer spins up a minimal hand-rolled RFC 6455 server over
// node:net. handler(ws) is called once the handshake request head has been
// read; ws exposes:
//   request     raw handshake request text (no trailing blank line)
//   upgrade(selected)  writes the 101 response, echoing the subprotocol
//   reject(status)     writes a non-101 HTTP error response
//   send(opcode, payload, fin)  unmasked server frame
//   close(code, reason)         server close frame
//   received     decoded client frames [{ opcode, fin, masked, maskKey, payload }]
//   onframe      optional callback fired per decoded client frame
function startWsServer(handler) {
  const server = net.createServer((socket) => {
    let headBuf = Buffer.alloc(0);
    let handshakeDone = false;
    let frameBuf = Buffer.alloc(0);
    const ws = {
      request: "",
      received: [],
      onframe: null,
      writeRaw(s) { socket.write(Buffer.from(s)); },
      upgrade(selected = "") {
        const extra = selected ? `Sec-WebSocket-Protocol: ${selected}\r\n` : "";
        ws.writeRaw(
          "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${ws.accept}\r\n` + extra + "\r\n");
      },
      reject(status) {
        ws.writeRaw(`HTTP/1.1 ${status} Nope\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
      },
      send(opcode, payload, fin = true) {
        const b = typeof payload === "string" ? Buffer.from(payload, "utf8") : Buffer.from(payload);
        const long = b.length >= 65536 ? 8 : b.length > 125 ? 2 : 0;
        const head = Buffer.alloc(2 + long);
        head[0] = (fin ? 0x80 : 0) | opcode;
        head[1] = long === 8 ? 127 : long === 2 ? 126 : b.length;
        if (long === 2) head.writeUInt16BE(b.length, 2);
        if (long === 8) head.writeBigUInt64BE(BigInt(b.length), 2);
        socket.write(Buffer.concat([head, b]));
      },
      close(code = 1000, reason = "") {
        const r = Buffer.from(reason, "utf8");
        const payload = Buffer.alloc(2 + r.length);
        payload.writeUInt16BE(code, 0);
        r.copy(payload, 2);
        ws.send(0x8, payload);
        socket.end(); // a real server half-closes after its close frame
      },
    };
    socket.on("error", () => {});
    socket.on("data", (data) => {
      if (!handshakeDone) {
        headBuf = Buffer.concat([headBuf, data]);
        const idx = headBuf.indexOf("\r\n\r\n");
        if (idx === -1) return;
        ws.request = headBuf.subarray(0, idx + 2).toString();
        const keyMatch = /Sec-WebSocket-Key: (\S+)/.exec(ws.request);
        ws.accept = keyMatch
          ? crypto.createHash("sha1").update(keyMatch[1] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64")
          : "";
        handshakeDone = true;
        frameBuf = headBuf.subarray(idx + 4);
        handler(ws);
        server.ws = ws; // expose the connection facade (send/close) to tests
        if (frameBuf.length) processFrameData();
        return;
      }
      frameBuf = Buffer.concat([frameBuf, data]);
      processFrameData();
    });

    function processFrameData() {
      for (;;) {
        if (frameBuf.length < 2) return;
        const fin = (frameBuf[0] & 0x80) !== 0;
        const opcode = frameBuf[0] & 0x0f;
        const masked = (frameBuf[1] & 0x80) !== 0;
        let len = frameBuf[1] & 0x7f;
        let off = 2;
        if (len === 126) {
          if (frameBuf.length < off + 2) return;
          len = frameBuf.readUInt16BE(off); off += 2;
        } else if (len === 127) {
          if (frameBuf.length < off + 8) return;
          len = Number(frameBuf.readBigUInt64BE(off)); off += 8;
        }
        let maskKey = null;
        if (masked) {
          if (frameBuf.length < off + 4) return;
          maskKey = frameBuf.subarray(off, off + 4);
          off += 4;
        }
        if (frameBuf.length < off + len) return;
        const raw = frameBuf.subarray(off, off + len);
        const frame = {
          opcode, fin, masked,
          maskKey: maskKey ? Uint8Array.from(maskKey) : null,
          payload: masked ? maskBytes(raw, maskKey) : Uint8Array.from(raw),
        };
        ws.received.push(frame);
        ws.onframe?.(frame);
        frameBuf = frameBuf.subarray(off + len);
      }
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// closeServer destroys every still-open fake client conn before closing the
// listener: server.close() waits for established connections to end, and a
// live TunnelWebSocket pump (conn.read() pending forever) would otherwise
// hang the runner after the last test.
function closeServer(server) {
  for (const conn of clientConns) conn.close();
  return new Promise((resolve) => server.close(resolve));
}

async function main() {
  // --- integration: handshake validation, echo, ping/pong, close ---
  {
    const server = await startWsServer((ws) => {
      ws.upgrade("pi-companion");
    });
    const { port } = server.address();
    const conn = makeConn("127.0.0.1", port);
    const events = { errors: [], closes: [] };
    const ws = new TunnelWebSocket(conn, "/ws/browser", {
      protocols: ["pi-companion", "token.secret123"],
      origin: "http://127.0.0.1:43722",
    });
    ws.onmessage = (e) => events.messages.push(e.data);
    ws.onerror = (e) => events.errors.push(e);
    ws.onclose = (e) => events.closes.push(e);

    // The server handler already upgraded; just await OPEN.
    const opened = await waitFor(() => ws.readyState === 1);
    check("handshake: reaches OPEN", opened, `readyState ${ws.readyState}, errors ${events.errors.length}`);

    // --- request shape: fresh server that records the request ---
    await closeServer(server);

    let seenRequest = null;
    const server2 = await startWsServer((ws) => {
      seenRequest = ws.request;
      ws.upgrade("pi-companion");
      // Echo data frames back, and complete a client-initiated closing
      // handshake by echoing the close frame (close() half-closes).
      ws.onframe = (frame) => {
        if (frame.opcode === 0x1 || frame.opcode === 0x2) {
          ws.send(frame.opcode, frame.payload);
        } else if (frame.opcode === 0x8 && frame.payload.length >= 2) {
          const view = new DataView(frame.payload.buffer, frame.payload.byteOffset, frame.payload.byteLength);
          ws.close(view.getUint16(0), frame.payload.length > 2 ? decodeUtf8(frame.payload.subarray(2)) : "");
        }
      };
    });
    const { port: port2 } = server2.address();
    const ws2 = new TunnelWebSocket(makeConn("127.0.0.1", port2), "/ws/browser", {
      protocols: ["pi-companion", "token.secret123"],
      origin: "http://127.0.0.1:43722",
    });
    await waitFor(() => ws2.readyState === 1);
    const req = seenRequest || "";
    check("handshake: GET request line", req.startsWith("GET /ws/browser HTTP/1.1\r\n"), req.split("\r\n")[0]);
    check("handshake: Upgrade header", req.includes("Upgrade: websocket\r\n"));
    check("handshake: Connection header", req.includes("Connection: Upgrade\r\n"));
    check("handshake: Sec-WebSocket-Version 13", req.includes("Sec-WebSocket-Version: 13\r\n"));
    const keyMatch = /Sec-WebSocket-Key: ([A-Za-z0-9+/=]{24})\r\n/.exec(req);
    check("handshake: 16-byte base64 key", !!keyMatch && Buffer.from(keyMatch[1], "base64").length === 16);
    check("handshake: subprotocols offered", req.includes("Sec-WebSocket-Protocol: pi-companion, token.secret123\r\n"));
    check("handshake: Origin header sent", req.includes("Origin: http://127.0.0.1:43722\r\n"));
    if (keyMatch) {
      check("handshake: accept check is RFC-correct",
        computeAccept(keyMatch[1]) === crypto.createHash("sha1").update(keyMatch[1] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64"));
    }

    // --- echo: text and binary frames over the open socket ---
    const textEcho = new Promise((resolve) => { ws2.onmessage = (e) => resolve(e.data); });
    ws2.send("hello over the tunnel");
    check("echo: text roundtrip", (await textEcho) === "hello over the tunnel");

    const bin = new Uint8Array([1, 2, 3, 250]);
    const binEcho = new Promise((resolve) => { ws2.onmessage = (e) => resolve(e.data); });
    ws2.send(bin);
    const gotBin = await binEcho;
    check("echo: binary roundtrip", gotBin instanceof Uint8Array && gotBin.length === 4 && gotBin[3] === 250);

    // --- close: client-initiated closing handshake ---
    const closeEvent = new Promise((resolve) => { ws2.onclose = resolve; });
    ws2.close(3001, "bye");
    const ev = await closeEvent;
    check("close: readyState CLOSED", ws2.readyState === 3);
    check("close: event code echoed", ev.code === 3001 && ev.reason === "bye" && ev.wasClean === true, ev);
    await closeServer(server2);
  }

  // --- integration: client frames are masked on the wire ---
  {
    let seen = null;
    const server = await startWsServer((ws) => {
      ws.upgrade("pi-companion");
      ws.onframe = (frame) => {
        if (!seen) seen = frame;
      };
    });
    const { port } = server.address();
    const ws = new TunnelWebSocket(makeConn("127.0.0.1", port), "/ws/browser", { protocols: ["pi-companion"] });
    await waitFor(() => ws.readyState === 1);

    // Text frame: must arrive masked with a 4-byte key and decode intact.
    ws.send("masked payload");
    check("masking: client frame arrives masked", await waitFor(() => seen?.opcode === 0x1 && seen.masked && seen.maskKey?.length === 4));
    check("masking: masked payload decodes intact", seen && decodeUtf8(seen.payload) === "masked payload");

    // Server ping -> client pongs automatically.
    seen = null;
    ws.onmessage = () => {};
    server.ws.send(0x9, "beat");
    check("ping/pong: client pongs server ping", await waitFor(() => seen?.opcode === 0xa && decodeUtf8(seen.payload) === "beat"));

    // Server-initiated close: client echoes the close frame and fires
    // onclose with the server's code.
    seen = null;
    const closeEvent = new Promise((resolve) => { ws.onclose = resolve; });
    server.ws.close(4001, "kicked");
    const ev = await closeEvent;
    check("server close: onclose code 4001", ev.code === 4001 && ev.reason === "kicked" && ev.wasClean === true, ev);
    check("server close: client echoes close frame", await waitFor(() => seen?.opcode === 0x8));
    check("server close: readyState CLOSED", ws.readyState === 3);
    await closeServer(server);
  }

  // --- integration: fragmented server message is reassembled ---
  {
    const server = await startWsServer((ws) => { ws.upgrade("pi-companion"); });
    const { port } = server.address();
    const ws = new TunnelWebSocket(makeConn("127.0.0.1", port), "/ws/browser", { protocols: ["pi-companion"] });
    await waitFor(() => ws.readyState === 1);
    const msg = new Promise((resolve) => { ws.onmessage = (e) => resolve(e.data); });
    server.ws.send(0x1, "frag", false);
    server.ws.send(0x0, "ment", false);
    server.ws.send(0x0, "ed!", true);
    check("server fragmentation: reassembled", (await msg) === "fragmented!");
    await closeServer(server);
  }

  // --- integration: non-101 response fails the handshake ---
  {
    const server = await startWsServer((ws) => { ws.reject(403); });
    const { port } = server.address();
    const events = { errors: [], closes: [] };
    const ws = new TunnelWebSocket(makeConn("127.0.0.1", port), "/ws/browser", { protocols: ["pi-companion"] });
    ws.onerror = (e) => events.errors.push(e);
    ws.onclose = (e) => events.closes.push(e);
    check("reject 403: onclose(1006) fires", await waitFor(() => events.closes.length === 1));
    check("reject 403: readyState CLOSED", ws.readyState === 3);
    check("reject 403: error mentions status", /403/.test(String(events.errors[0])), events.errors[0]);
    await closeServer(server);
  }

  // --- integration: bad Sec-WebSocket-Accept fails the handshake ---
  {
    const server = await startWsServer((ws) => {
      ws.writeRaw(
        "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        "Sec-WebSocket-Accept: bogusacceptvalue\r\n" +
        "Sec-WebSocket-Protocol: pi-companion\r\n\r\n");
    });
    const { port } = server.address();
    const events = { errors: [], closes: [] };
    const ws = new TunnelWebSocket(makeConn("127.0.0.1", port), "/ws/browser", { protocols: ["pi-companion"] });
    ws.onerror = (e) => events.errors.push(e);
    ws.onclose = (e) => events.closes.push(e);
    check("bad accept: onclose(1006) fires", await waitFor(() => events.closes.length === 1));
    check("bad accept: error mentions accept", /accept/i.test(String(events.errors[0])), events.errors[0]);
    await closeServer(server);
  }

  // --- integration: unexpected subprotocol fails the handshake ---
  {
    const server = await startWsServer((ws) => { ws.upgrade("other-protocol"); });
    const { port } = server.address();
    const events = { errors: [], closes: [] };
    const ws = new TunnelWebSocket(makeConn("127.0.0.1", port), "/ws/browser", { protocols: ["pi-companion"] });
    ws.onerror = (e) => events.errors.push(e);
    ws.onclose = (e) => events.closes.push(e);
    check("bad subprotocol: onclose(1006) fires", await waitFor(() => events.closes.length === 1));
    check("bad subprotocol: error names it", /subprotocol/.test(String(events.errors[0])), events.errors[0]);
    await closeServer(server);
  }

  // --- integration: EOF during handshake fails cleanly ---
  {
    const server = net.createServer((socket) => {
      socket.on("error", () => {});
      // Keep the socket flowing: a paused socket never processes the
      // client's FIN/RST, never emits close, and server.close() then waits
      // forever (the runner would hang after the last test).
      socket.on("data", () => {});
      socket.end(); // close without any response
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const events = { errors: [], closes: [] };
    const ws = new TunnelWebSocket(makeConn("127.0.0.1", port), "/ws/browser", { protocols: ["pi-companion"] });
    ws.onerror = (e) => events.errors.push(e);
    ws.onclose = (e) => events.closes.push(e);
    check("EOF handshake: onclose(1006) fires", await waitFor(() => events.closes.length === 1));
    check("EOF handshake: error mentions closed", /closed/i.test(String(events.errors[0])), events.errors[0]);
    await closeServer(server);
  }

  // --- integration: close frame is flushed before the half-close ---
  // Reproduces the tunnel failure "connection closed before response
  // headers were complete": the tailcat WASM conn runs write() and
  // closeWrite() on independent goroutines, so calling closeWrite() before
  // the write's promise resolves sends the FIN before the payload bytes
  // and the peer sees an empty stream. The shim must await the write
  // before half-closing.
  {
    const log = [];
    const writes = [];
    let pendingWrite = Promise.resolve();
    let reads = 0;
    // Scripted conn: handshake succeeds on first read, then blocks; write
    // resolves on a later macrotask (like the WASM goroutine), closeWrite
    // logs a FIN the moment it is called.
    const conn = {
      port: 43722,
      write(bytes) {
        const copy = Uint8Array.from(bytes);
        pendingWrite = pendingWrite.then(() => new Promise((res) => setTimeout(() => {
          writes.push(copy);
          log.push({ type: "data", bytes: copy });
          res();
        }, 0)));
        return pendingWrite;
      },
      closeWrite() {
        log.push({ type: "fin" });
        return Promise.resolve();
      },
      close() { log.push({ type: "close" }); },
      read: async () => {
        if (reads++ === 0) {
          await pendingWrite;
          const req = decodeUtf8(writes[0]);
          const key = /Sec-WebSocket-Key: (\S+)/.exec(req)[1];
          return utf8(
            "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            `Sec-WebSocket-Accept: ${computeAccept(key)}\r\n` +
            "Sec-WebSocket-Protocol: pi-companion\r\n\r\n");
        }
        return new Promise(() => {}); // pump blocks; no handle, exits cleanly
      },
    };
    const ws = new TunnelWebSocket(conn, "/ws/browser", { protocols: ["pi-companion"] });
    check("close ordering: handshake reaches OPEN", await waitFor(() => ws.readyState === 1));
    ws.close(1000, "bye");
    await new Promise((r) => setTimeout(r, 50));
    const finIdx = log.findIndex((e) => e.type === "fin");
    const closeFrameIdx = log.findIndex((e) => e.type === "data" && e.bytes[0] === 0x88);
    check("close ordering: close frame flushed before half-close",
      closeFrameIdx !== -1 && finIdx > closeFrameIdx,
      log.map((e) => e.type + (e.type === "data" ? ` op=0x${e.bytes[0].toString(16)}` : "")));
  }

  console.log(failures === 0 ? "\nall tests passed" : `\n${failures} test(s) failed`);
  // Exit via exitCode and let the event loop drain: process.exit() would
  // truncate the pending async stdout write above when output is piped.
  process.exitCode = failures === 0 ? 0 : 1;
}


main().catch((err) => {
  console.error(err);
  process.exit(1);
});
