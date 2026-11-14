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
// The Host header is a placeholder: the daemon serves the API regardless of
// host, and the tunnel carries no virtual-host routing.
export function encodeRequest(method, path, body) {
  const lines = [
    `${method.toUpperCase()} ${path} HTTP/1.1`,
    "Host: companion.device",
    "Connection: close",
    "Accept: */*",
  ];
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

// bridgeFetch(addr, port, method, path, body) dials a stream through the
// tailcat tunnel (via window.bridge.dial), sends one HTTP/1.1 request, and
// resolves to { status, statusText, headers, bodyText, bodyJson() }.
// A plain string body is sent as-is; any other non-null body is JSON-encoded.
// The stream is always closed before returning.
export async function bridgeFetch(addr, port, method, path, body) {
  const bridge = (globalThis.window && globalThis.window.bridge) || globalThis.bridge;
  if (!bridge || typeof bridge.dial !== "function") {
    throw new Error("window.bridge.dial is not available");
  }
  const conn = await bridge.dial(addr, port);
  try {
    const parser = createResponseParser();
    conn.write(encodeRequest(method, path, body));
    conn.closeWrite(); // half-close: the request is complete
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
    const { status, statusText, headers, body: bodyBytes } = parser.result();
    const bodyText = new TextDecoder().decode(bodyBytes);
    return {
      status,
      statusText,
      headers,
      bodyText,
      bodyJson() {
        return JSON.parse(bodyText);
      },
    };
  } finally {
    conn.close();
  }
}
