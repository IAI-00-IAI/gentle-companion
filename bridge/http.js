// HTTP-over-stream shim for the Companion bridge (spec S2, task T2).
//
// Issues fetch-like requests to the daemon device API (/api/*) through a
// tailcat tunnel stream obtained from window.bridge.dial. Plain JavaScript,
// no build step; loaded as an ES module by app.js.
//
// Wire strategy: requests are HTTP/1.1 with "Connection: close", so the
// daemon closes the stream after the response and responses are delimited
// by end-of-stream. Bodies are delimited strictly by Content-Length when
// the daemon sends one; responses without Content-Length are read to EOF.
// Chunked transfer encoding is intentionally not implemented.

const CRLF = "\r\n";

// utf8 encodes a string as UTF-8 bytes.
function utf8(s) {
  return new TextEncoder().encode(s);
}

// concatBytes appends src to dst, returning a new array.
function concatBytes(dst, src) {
  const out = new Uint8Array(dst.length + src.length);
  out.set(dst);
  out.set(src, dst.length);
  return out;
}

// encodeRequest serializes a request method + path + optional body into
// HTTP/1.1 bytes ready to write on a tunneled conn. A plain string body is
// sent as-is; any other non-null body is JSON-encoded. When a body is
// present, Content-Type: application/json and Content-Length are included.
// headers (optional) adds extra request headers (e.g. Authorization for the
// daemon's device surface); keys are emitted as given, first letter uppercased
// like the fixed headers. The Host header is a placeholder: the daemon serves
// the API regardless of host, and the tunnel carries no virtual-host routing.
export function encodeRequest(method, path, body, headers) {
  const lines = [
    `${method.toUpperCase()} ${path} HTTP/1.1`,
    "Host: companion.device",
    "Connection: close",
    "Accept: */*",
  ];
  for (const [name, value] of Object.entries(headers ?? {})) {
    lines.push(`${name.replace(/(^|-)(\w)/g, (_, sep, ch) => sep + ch.toUpperCase())}: ${value}`);
  }
  let bodyBytes = null;
  if (body !== undefined && body !== null) {
    bodyBytes = typeof body === "string" ? utf8(body) : utf8(JSON.stringify(body));
    lines.push("Content-Type: application/json");
    lines.push(`Content-Length: ${bodyBytes.length}`);
  }
  const head = utf8(lines.join(CRLF) + CRLF + CRLF);
  return bodyBytes === null ? head : concatBytes(head, bodyBytes);
}

// createResponseParser returns an incremental HTTP/1.1 response parser.
//
//   parser.push(chunk) -> boolean  // true once the response is complete
//   parser.finish()                // call once at end-of-stream (EOF)
//   parser.result()                // { status, statusText, headers, body }
//
// push accumulates bytes until the head (status line + headers) is complete,
// then collects the body: strictly Content-Length bytes when that header is
// present, otherwise everything until EOF (Connection: close semantics).
// finish() completes a body being read to EOF and throws if EOF arrives too
// early. Header names are lowercased in the result object.
export function createResponseParser() {
  let buf = new Uint8Array(0);
  let stage = "head"; // head | body | done
  let status = 0;
  let statusText = "";
  let headers = {};
  let contentLength = -1; // -1: read body to EOF
  let body = new Uint8Array(0);

  // findHeadEnd returns the index of the first \r\n\r\n in b, or -1.
  function findHeadEnd(b) {
    for (let i = 0; i + 3 < b.length; i++) {
      if (b[i] === 13 && b[i + 1] === 10 && b[i + 2] === 13 && b[i + 3] === 10) {
        return i;
      }
    }
    return -1;
  }

  function parseHead() {
    const idx = findHeadEnd(buf);
    if (idx === -1) {
      return false;
    }
    const headText = new TextDecoder().decode(buf.subarray(0, idx));
    body = buf.subarray(idx + 4);
    buf = new Uint8Array(0);

    const lines = headText.split("\r\n");
    const m = /^HTTP\/\d\.\d (\d{3})(?: (.*))?$/.exec(lines[0]);
    if (!m) {
      throw new Error(`malformed HTTP status line: ${JSON.stringify(lines[0])}`);
    }
    status = Number(m[1]);
    statusText = m[2] || "";
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) {
        continue;
      }
      const colon = line.indexOf(":");
      if (colon === -1) {
        continue; // tolerate malformed header lines
      }
      headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }
    if (headers["content-length"] !== undefined) {
      contentLength = Number(headers["content-length"]);
      if (!Number.isInteger(contentLength) || contentLength < 0) {
        throw new Error(`invalid Content-Length: ${headers["content-length"]}`);
      }
    }
    stage = "body";
    return true;
  }

  function parseBody() {
    if (contentLength >= 0) {
      // Accumulate the pending buffer into the body BEFORE the length check:
      // subsequent chunks arrive in buf, and without this the body stays frozen
      // at whatever the head chunk carried past the header end (a multi-chunk
      // response then reports 'connection closed after N of M body bytes').
      body = concatBytes(body, buf);
      buf = new Uint8Array(0);
      if (body.length < contentLength) {
        return false; // need more bytes
      }
      body = body.subarray(0, contentLength); // strict: ignore any excess
      stage = "done";
      return true;
    }
    // No Content-Length: Connection: close semantics, read to EOF.
    body = concatBytes(body, buf);
    buf = new Uint8Array(0);
    return false;
  }

  return {
    push(chunk) {
      if (stage === "done") {
        throw new Error("data received after end of response");
      }
      buf = concatBytes(buf, chunk);
      if (stage === "head" && !parseHead()) {
        return false;
      }
      if (stage === "body") {
        return parseBody();
      }
      return false;
    },

    finish() {
      if (stage === "done") {
        return;
      }
      if (stage === "head") {
        throw new Error("connection closed before response headers were complete");
      }
      if (contentLength >= 0) {
        throw new Error(
          `connection closed after ${body.length} of ${contentLength} body bytes`,
        );
      }
      stage = "done"; // body delimited by EOF: complete
    },

    result() {
      if (stage !== "done") {
        throw new Error("response is not complete");
      }
      return { status, statusText, headers, body };
    },
  };
}

// The dialer used by bridgeFetch. In the browser, window.bridge.dial (set by
// app.js) is picked up automatically; tests can inject their own with
// setBridgeDialer.
let dialer = null;
export function setBridgeDialer(fn) { dialer = fn; }
function currentDialer() {
  if (dialer) return dialer;
  const bridge = (globalThis.window && globalThis.window.bridge) || globalThis.bridge;
  if (bridge && typeof bridge.dial === "function") return bridge.dial;
  return null;
}

// bridgeFetch(addr, port, method, path, body, headers, dial) dials a stream through
// the tailcat tunnel — via the optional explicit dial argument, the injected dialer
// (setBridgeDialer), or window.bridge.dial — sends one HTTP/1.1 request, and resolves
// to { status, statusText, headers, bodyText, bodyJson() }. An explicit dial argument
// is preferred: the module-level dialer is a single global, and concurrent callers
// (a UI issuing parallel requests) would otherwise clear each other's dialer.
// A plain string body is sent as-is; any other non-null body is JSON-encoded.
// headers (optional) adds extra request headers, e.g. the device token's
// Authorization line. The stream is always closed before returning.
export async function bridgeFetch(addr, port, method, path, body, headers, dial) {
  const usedDial = dial ?? currentDialer();
  if (!usedDial) {
    throw new Error("no bridge dialer available");
  }
  const conn = await usedDial(addr, port);
  try {
    const parser = createResponseParser();
    // Await the write before anything else: tailcat's WASM conn runs write and
    // closeWrite on independent goroutines, so an un-awaited write lets the FIN
    // overtake the request bytes and the daemon sees an empty stream.
    // No half-close at all: relaying the FIN through the DERP relay right after
    // the write drops in-flight request bytes (measured: 2/10 GETs and 3/3 POSTs
    // read back as 0-byte EOF with closeWrite; 10/10 OK without it). The daemon
    // answers with "connection: close" and ends the stream itself, so read()
    // hits EOF either way; the shim's finish() handles both delimiters.
    await conn.write(encodeRequest(method, path, body, headers));
    for (;;) {
      const chunk = await conn.read();
      if (chunk === null) {
        parser.finish();
        break;
      }
      if (parser.push(chunk)) {
        break;
      }
    }
    const { status, statusText, headers: responseHeaders, body: bodyBytes } = parser.result();
    const bodyText = new TextDecoder().decode(bodyBytes);
    return {
      status,
      statusText,
      headers: responseHeaders,
      bodyText,
      bodyJson() {
        return JSON.parse(bodyText);
      },
    };
  } finally {
    conn.close();
  }
}
