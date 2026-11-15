// Node test for the bridge HTTP-over-stream shim (bridge/http.js).
// Run: node bridge/http_test.mjs   (no dependencies)
//
// Spins up a plain Node http server on 127.0.0.1 and fakes the tailcat conn
// by piping it through a TCP socket, implementing the same conn semantics as
// window.bridge.dial: read()/write()/closeWrite()/close().

import http from "node:http";
import net from "node:net";
import { bridgeFetch, createResponseParser, encodeRequest } from "./http.js";

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`ok - ${name}`);
  } else {
    failures++;
    console.error(`FAIL - ${name}${detail ? `: ${detail}` : ""}`);
  }
}

// makeConn adapts a node:net Socket to the conn semantics of
// window.bridge.dial: pull-based read() resolving to Uint8Array|null (null on
// EOF), write(Uint8Array), closeWrite() half-close, close().
function makeConn(host, port) {
  const socket = net.connect({ host, port });
  const pending = [];
  let reads = [];
  let eof = false;
  let closed = false;

  socket.on("data", (data) => {
    const chunk = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (reads.length) {
      reads.shift()(chunk);
    } else {
      pending.push(chunk);
    }
  });
  socket.on("end", () => {
    eof = true;
    while (reads.length) reads.shift()(null);
  });
  socket.on("error", () => {}); // surfaced via read/write failures
  socket.on("close", () => {
    closed = true;
    eof = true;
    while (reads.length) reads.shift()(null);
  });

  return {
    port,
    read() {
      if (pending.length) return Promise.resolve(pending.shift());
      if (eof) return Promise.resolve(null);
      return new Promise((resolve) => reads.push(resolve));
    },
    write(bytes) {
      socket.write(Buffer.from(bytes));
    },
    closeWrite() {
      socket.end();
    },
    close() {
      if (!closed) socket.destroy();
    },
  };
}

// fakeBridge installs window.bridge.dial backed by makeConn.
function fakeBridge() {
  globalThis.window = globalThis.window || {};
  globalThis.window.bridge = {
    dial: (addr, port) => Promise.resolve(makeConn(addr, port)),
  };
}

// startServer starts a plain Node http server with deterministic routes.
function startServer() {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.method === "GET" && req.url === "/api/settings") {
        // Send Content-Length explicitly, like the Rust daemon does, so the
        // response is Content-Length-delimited rather than chunked (the shim
        // implements strict Content-Length, not chunked transfer decoding).
        const body = JSON.stringify({ theme: "dark", port: 3000 });
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        });
        res.end(body);
      } else if (req.method === "POST" && req.url === "/api/pairing/start") {
        let parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch {}
        let status, payload;
        if (parsed && parsed.code) {
          status = 201;
          payload = JSON.stringify({ accepted: true, code: parsed.code });
        } else {
          status = 400;
          payload = JSON.stringify({ error: "code required" });
        }
        res.writeHead(status, {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        });
        res.end(payload);
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function main() {
  // --- unit: request encoding ---
  {
    const req = new TextDecoder().decode(encodeRequest("GET", "/api/settings"));
    check("encode GET: request line", req.startsWith("GET /api/settings HTTP/1.1\r\n"), req);
    check("encode GET: Host placeholder", req.includes("Host: companion.device\r\n"), req);
    check("encode GET: Connection: close", req.includes("Connection: close\r\n"), req);
    check("encode GET: no Content-Length", !req.includes("Content-Length"), req);
    check("encode GET: head ends with blank line", req.endsWith("\r\n\r\n"), req);

    const post = new TextDecoder().decode(encodeRequest("POST", "/api/pairing/start", { code: "1234" }));
    const body = '{"code":"1234"}';
    check("encode POST: Content-Type json", post.includes("Content-Type: application/json\r\n"), post);
    check("encode POST: Content-Length", post.includes(`Content-Length: ${body.length}\r\n`), post);
    check("encode POST: body bytes", post.endsWith(body), post);

    const raw = new TextDecoder().decode(encodeRequest("POST", "/x", "raw-body"));
    check("encode POST: string body as-is", raw.endsWith("raw-body"), raw);
  }

  // --- unit: response parser, Content-Length strictness ---
  {
    // Complete response in one push.
    const p1 = createResponseParser();
    const full = new TextEncoder().encode("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nhi");
    check("parser: single push completes", p1.push(full) === true);
    check("parser: status", p1.result().status === 200);
    check("parser: statusText", p1.result().statusText === "OK");
    check("parser: content-length header", p1.result().headers["content-length"] === "2");
    check("parser: body", new TextDecoder().decode(p1.result().body) === "hi");

    // Split head across pushes; body read to EOF.
    const p2 = createResponseParser();
    check("parser: partial head", p2.push(new TextEncoder().encode("HTTP/1.1 404 Not F")) === false);
    check("parser: rest of head", p2.push(new TextEncoder().encode("ound\r\nX-A: 1\r\n\r\nbo")) === false);
    p2.push(new TextEncoder().encode("dy"));
    p2.finish();
    const r2 = p2.result();
    check("parser: split status", r2.status === 404 && r2.statusText === "Not Found");
    check("parser: split header", r2.headers["x-a"] === "1");
    check("parser: EOF-delimited body", new TextDecoder().decode(r2.body) === "body");

    // Truncated Content-Length body must fail at finish().
    const p3 = createResponseParser();
    p3.push(new TextEncoder().encode("HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nabc"));
    let threw = false;
    try {
      p3.finish();
    } catch (e) {
      threw = /closed after 3 of 10/.test(e.message);
    }
    check("parser: truncated body throws", threw);

    // Malformed status line throws.
    const p4 = createResponseParser();
    let threw2 = false;
    try {
      p4.push(new TextEncoder().encode("NOT HTTP\r\n\r\n"));
      p4.finish();
    } catch (e) {
      threw2 = /malformed HTTP status line/.test(e.message);
    }
    check("parser: malformed status line throws", threw2);
  }

  // --- integration: bridgeFetch against a real Node http server ---
  fakeBridge();
  const server = await startServer();
  const { port } = server.address();
  const addr = "127.0.0.1";

  try {
    // GET /api/settings
    const get = await bridgeFetch(addr, port, "GET", "/api/settings");
    check("fetch GET: status", get.status === 200, `got ${get.status}`);
    check("fetch GET: content-type header", get.headers["content-type"] === "application/json");
    check("fetch GET: bodyText", get.bodyText === '{"theme":"dark","port":3000}', get.bodyText);
    check("fetch GET: bodyJson", get.bodyJson().theme === "dark" && get.bodyJson().port === 3000);

    // POST /api/pairing/start with a JSON body
    const post = await bridgeFetch(addr, port, "POST", "/api/pairing/start", { code: "4321" });
    check("fetch POST: status", post.status === 201, `got ${post.status}`);
    check("fetch POST: bodyJson roundtrip", post.bodyJson().accepted === true && post.bodyJson().code === "4321");

    // POST with a missing field -> 400 error path
    const bad = await bridgeFetch(addr, port, "POST", "/api/pairing/start", {});
    check("fetch POST: 400 status", bad.status === 400, `got ${bad.status}`);
    check("fetch POST: error body", bad.bodyJson().error === "code required");

    // Unknown route -> 404
    const nf = await bridgeFetch(addr, port, "GET", "/api/nope");
    check("fetch GET: 404 status", nf.status === 404, `got ${nf.status}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(failures === 0 ? "\nall tests passed" : `\n${failures} test(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
