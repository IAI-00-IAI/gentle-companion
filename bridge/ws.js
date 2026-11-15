// WebSocket-over-stream shim for the Companion bridge (spec S3, task T3).
//
// Implements the /ws/browser handshake and RFC 6455 framing over a tailcat
// tunnel conn from window.bridge.dial, exposing the WebSocket surface the
// UI's LiveConnection (ui/src/lib/connection.ts) actually uses: readyState
// constants, send(string|Uint8Array), close(code, reason), and the
// onopen/onmessage/onclose/onerror handlers. Plain JavaScript, no build
// step; loaded as an ES module.
//
// Wire notes:
//   - Client-to-server frames are always masked (RFC 6455 section 5.3).
//   - Text, binary, ping/pong, and close frames are supported; fragmented
//     data messages are reassembled before delivery. Control frames may
//     interleave with fragments, as the protocol requires.
//   - Web Crypto has no SHA-1 digest, so a small pure-JS SHA-1 backs the
//     Sec-WebSocket-Accept check.

const CRLF = "\r\n";
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const OP_CONT = 0x0;
const OP_TEXT = 0x1;
const OP_BINARY = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

// utf8 encodes a string as UTF-8 bytes.
function utf8(s) {
  return new TextEncoder().encode(s);
}

// utf8Decode decodes UTF-8 bytes back to a string.
function utf8Decode(bytes) {
  return new TextDecoder().decode(bytes);
}

// concatBytes appends src to dst, returning a new array.
function concatBytes(dst, src) {
  const out = new Uint8Array(dst.length + src.length);
  out.set(dst);
  out.set(src, dst.length);
  return out;
}

// randomBytes fills an array with cryptographically strong bytes, falling
// back to Math.random where crypto.getRandomValues is unavailable.
function randomBytes(n) {
  const bytes = new Uint8Array(n);
  if (globalThis.crypto && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

// base64 encodes bytes with btoa (available in browsers and Node >= 16).
export function base64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

// sha1 returns the 20-byte SHA-1 digest of bytes. Pure JS because
// crypto.subtle.digest does not implement "SHA-1" in every engine we
// target (and is async, which the synchronous handshake check need not be).
export function sha1(bytes) {
  let paddedLen = bytes.length + 1;
  paddedLen += (56 - (paddedLen % 64) + 64) % 64;
  const msg = new Uint8Array(paddedLen + 8);
  msg.set(bytes);
  msg[bytes.length] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(paddedLen, Math.floor(bytes.length / 536870912));
  view.setUint32(paddedLen + 4, (bytes.length << 3) >>> 0);

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe;
  let h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let i = 0; i < msg.length; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = view.getUint32(i + j * 4);
    for (let j = 16; j < 80; j++) {
      const n = w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16];
      w[j] = (n << 1) | (n >>> 31);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let j = 0; j < 80; j++) {
      let f, k;
      if (j < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (j < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (j < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[j]) >>> 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, h0);
  ov.setUint32(4, h1);
  ov.setUint32(8, h2);
  ov.setUint32(12, h3);
  ov.setUint32(16, h4);
  return out;
}

// computeAccept derives the Sec-WebSocket-Accept value for a handshake key:
// base64(SHA-1(key + WS_GUID)), per RFC 6455 section 4.2.2.
export function computeAccept(key) {
  return base64(sha1(utf8(key + WS_GUID)));
}

// randomMask returns the 4-byte frame mask key for client frames.
function randomMask() {
  return randomBytes(4);
}

// encodeFrame serializes one RFC 6455 frame. Client frames are masked by
// default (the browser is always the client here); a plain string payload
// is sent as UTF-8. options: { mask = true, fin = true }.
export function encodeFrame(opcode, payload, options = {}) {
  const { mask = true, fin = true } = options;
  const bytes = typeof payload === "string" ? utf8(payload) : payload;
  const long = bytes.length >= 65536 ? 8 : bytes.length > 125 ? 2 : 0;
  const head = new Uint8Array(2 + long + (mask ? 4 : 0));
  head[0] = (fin ? 0x80 : 0) | opcode;
  head[1] = (mask ? 0x80 : 0) | (long === 8 ? 127 : long === 2 ? 126 : bytes.length);
  const view = new DataView(head.buffer);
  if (long === 2) view.setUint16(2, bytes.length);
  if (long === 8) view.setBigUint64(2, BigInt(bytes.length));
  let maskKey = null;
  if (mask) {
    maskKey = randomMask();
    head.set(maskKey, 2 + long);
  }
  const body = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    body[i] = bytes[i] ^ (mask ? maskKey[i % 4] : 0);
  }
  return concatBytes(head, body);
}

// findHeadEnd returns the index of the first \r\n\r\n in b, or -1.
function findHeadEnd(b) {
  for (let i = 0; i + 3 < b.length; i++) {
    if (b[i] === 13 && b[i + 1] === 10 && b[i + 2] === 13 && b[i + 3] === 10) {
      return i;
    }
  }
  return -1;
}

// createFrameParser returns an incremental RFC 6455 frame decoder for the
// (server-to-client) stream direction, where frames are unmasked. Masked
// client-direction frames are decoded too, so the tests can round-trip.
//
//   parser.push(chunk) -> frames  // [{ fin, opcode, payload }, ...]
//
// Bytes arriving between frames are buffered; frames split across pushes
// are completed as their bytes arrive.
export function createFrameParser() {
  let buf = new Uint8Array(0);

  return {
    push(chunk) {
      buf = concatBytes(buf, chunk);
      const frames = [];
      for (;;) {
        if (buf.length < 2) break;
        const fin = (buf[0] & 0x80) !== 0;
        const opcode = buf[0] & 0x0f;
        const masked = (buf[1] & 0x80) !== 0;
        let len = buf[1] & 0x7f;
        let offset = 2;
        if (len === 126) {
          if (buf.length < offset + 2) break;
          len = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint16(offset);
          offset += 2;
        } else if (len === 127) {
          if (buf.length < offset + 8) break;
          len = Number(new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getBigUint64(offset));
          offset += 8;
        }
        const maskAt = offset;
        if (masked) offset += 4;
        if (buf.length < offset + len) break;
        let payload = buf.subarray(offset, offset + len);
        if (masked) {
          const key = buf.subarray(maskAt, maskAt + 4);
          const un = new Uint8Array(len);
          for (let i = 0; i < len; i++) un[i] = payload[i] ^ key[i % 4];
          payload = un;
        }
        frames.push({ fin, opcode, payload });
        buf = buf.subarray(offset + len);
      }
      return frames;
    },
  };
}

// TunnelWebSocket is a WebSocket-like client over one tunneled stream.
//
//   new TunnelWebSocket(conn, path, { protocols, origin })
//
// conn is a dial() stream ({ read, write, closeWrite, close }); path is the
// request target (e.g. "/ws/browser"); protocols lists the
// Sec-WebSocket-Protocol values to offer (the daemon answers
// "pi-companion"); origin is sent as the Origin header, which the daemon's
// paired-device surface requires to be an allowed page origin.
//
// The handshake is validated strictly: 101 status, Upgrade: websocket,
// Sec-WebSocket-Accept (SHA-1 + GUID), and the selected subprotocol echoed
// from the offered list. On failure the socket is closed and onerror plus
// onclose({code: 1006}) fire.
export class TunnelWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url = "";
  readyState = TunnelWebSocket.CONNECTING;

  onopen = null;
  onmessage = null;
  onerror = null;
  onclose = null;

  #conn;
  #parser = createFrameParser();
  #sentClose = false;
  #closeFired = false;
  #fragments = null;
  #fragmentOpcode = 0;

  constructor(conn, path, { protocols = [], origin = "" } = {}) {
    this.url = path;
    this.#conn = conn;
    this.#handshake(path, protocols, origin);
  }

  // send writes one data frame: strings as text, anything else as binary.
  // Like the browser WebSocket, sending while not OPEN throws.
  send(data) {
    if (this.readyState !== TunnelWebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }
    const opcode = typeof data === "string" ? OP_TEXT : OP_BINARY;
    this.#conn.write(encodeFrame(opcode, data));
  }

  // close starts the closing handshake. While OPEN it sends a close frame
  // and half-closes the stream; the peer's close echo (or EOF) completes
  // it. While still CONNECTING it simply drops the stream.
  async close(code = 1000, reason = "") {
    if (this.readyState === TunnelWebSocket.OPEN) {
      const reasonBytes = utf8(reason);
      const payload = new Uint8Array(2 + reasonBytes.length);
      new DataView(payload.buffer).setUint16(0, code);
      payload.set(reasonBytes, 2);
      this.#sentClose = true;
      this.readyState = TunnelWebSocket.CLOSING;
      try {
        // The tailcat WASM conn runs write() and closeWrite() on
        // independent goroutines: closeWrite() called before the write's
        // promise resolves can deliver the FIN before the frame bytes,
        // so the peer sees an empty stream. Await the write first.
        await this.#conn.write(encodeFrame(OP_CLOSE, payload));
        await this.#conn.closeWrite();
      } catch {}
    } else if (this.readyState === TunnelWebSocket.CONNECTING) {
      this.#sentClose = true;
      this.#fireClose({ code: 1006, reason: "", wasClean: false });
    }
  }

  async #handshake(path, protocols, origin) {
    try {
      const key = base64(randomBytes(16));
      const lines = [
        `GET ${path} HTTP/1.1`,
        "Host: companion.device",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
      ];
      if (protocols.length) {
        lines.push(`Sec-WebSocket-Protocol: ${protocols.join(", ")}`);
      }
      if (origin) {
        lines.push(`Origin: ${origin}`);
      }
      this.#conn.write(utf8(lines.join(CRLF) + CRLF + CRLF));

      const { head, rest } = await this.#readResponseHead();
      this.#validateResponse(head, key, protocols);

      this.readyState = TunnelWebSocket.OPEN;
      this.onopen?.();
      for (const frame of this.#parser.push(rest)) {
        this.#handle(frame);
      }
      await this.#pump();
    } catch (err) {
      this.#fail(err);
    }
  }

  // readResponseHead accumulates stream bytes until the 101 response head
  // (status line + headers) is complete, returning the remaining bytes.
  async #readResponseHead() {
    let buf = new Uint8Array(0);
    for (;;) {
      const idx = findHeadEnd(buf);
      if (idx !== -1) {
        return {
          head: utf8Decode(buf.subarray(0, idx)),
          rest: buf.subarray(idx + 4),
        };
      }
      const chunk = await this.#conn.read();
      if (chunk === null) {
        throw new Error("connection closed during WebSocket handshake");
      }
      buf = concatBytes(buf, chunk);
      if (buf.length > 65536) {
        throw new Error("oversized WebSocket handshake response");
      }
    }
  }

  // validateResponse checks the 101 response: status, Upgrade header,
  // Sec-WebSocket-Accept digest, and the echoed subprotocol.
  #validateResponse(head, key, protocols) {
    const lines = head.split(CRLF);
    const status = /^HTTP\/\d\.\d (\d{3})(?: (.*))?$/.exec(lines[0]);
    if (!status) {
      throw new Error(`malformed handshake status line: ${JSON.stringify(lines[0])}`);
    }
    if (status[1] !== "101") {
      throw new Error(`WebSocket handshake rejected: ${status[1]} ${status[2] || ""}`.trim());
    }
    const headers = {};
    for (let i = 1; i < lines.length; i++) {
      const colon = lines[i].indexOf(":");
      if (colon !== -1) {
        headers[lines[i].slice(0, colon).trim().toLowerCase()] =
          lines[i].slice(colon + 1).trim();
      }
    }
    if (!/websocket/i.test(headers["upgrade"] || "")) {
      throw new Error("handshake response is not a WebSocket upgrade");
    }
    if (headers["sec-websocket-accept"] !== computeAccept(key)) {
      throw new Error("Sec-WebSocket-Accept mismatch");
    }
    const selected = headers["sec-websocket-protocol"] || "";
    if (protocols.length && !protocols.includes(selected)) {
      throw new Error(`unexpected subprotocol selected: ${JSON.stringify(selected)}`);
    }
  }

  // pump drains the stream into the frame parser and dispatches frames.
  async #pump() {
    for (;;) {
      let chunk;
      try {
        chunk = await this.#conn.read();
      } catch (err) {
        this.#fail(err);
        return;
      }
      if (chunk === null) {
        // EOF: clean if a close frame was exchanged, abrupt otherwise.
        this.#fail(new Error("connection closed"));
        return;
      }
      for (const frame of this.#parser.push(chunk)) {
        this.#handle(frame);
      }
    }
  }

  // handle dispatches one decoded frame. Data messages may arrive
  // fragmented; fragments are accumulated until the fin bit. Control
  // frames (ping/pong/close) may interleave with fragments, as RFC 6455
  // section 5.4 requires.
  #handle(frame) {
    switch (frame.opcode) {
      case OP_CONT: {
        if (!this.#fragments) return; // stray continuation: ignore
        this.#fragments.push(frame.payload);
        if (!frame.fin) return;
        let all = this.#fragments[0];
        for (let i = 1; i < this.#fragments.length; i++) {
          all = concatBytes(all, this.#fragments[i]);
        }
        const opcode = this.#fragmentOpcode;
        this.#fragments = null;
        this.#deliver(opcode, all);
        return;
      }
      case OP_TEXT:
      case OP_BINARY:
        if (!frame.fin) {
          // Start of a fragmented message: buffer it until the fin bit.
          this.#fragments = [frame.payload];
          this.#fragmentOpcode = frame.opcode;
          return;
        }
        this.#deliver(frame.opcode, frame.payload);
        return;
      case OP_CLOSE:
        this.#handleClose(frame);
        return;
      case OP_PING:
        if (this.readyState === TunnelWebSocket.OPEN) {
          try {
            this.#conn.write(encodeFrame(OP_PONG, frame.payload));
          } catch {}
        }
        return;
      case OP_PONG:
        return; // liveness replies need no action
      default:
        this.#deliver(frame.opcode, frame.payload);
    }
  }

  #deliver(opcode, payload) {
    if (opcode === OP_TEXT) {
      this.onmessage?.({ data: utf8Decode(payload) });
    } else {
      this.onmessage?.({ data: payload });
    }
  }

  async #handleClose(frame) {
    let code = 1005;
    let reason = "";
    if (frame.payload.length >= 2) {
      const view = new DataView(
        frame.payload.buffer, frame.payload.byteOffset, frame.payload.byteLength);
      code = view.getUint16(0);
      reason = utf8Decode(frame.payload.subarray(2));
    }
    if (!this.#sentClose) {
      // Echo the close frame, then half-close so the peer sees EOF.
      this.#sentClose = true;
      try {
        // Await the write before closeWrite(): see the ordering note in
        // close() — the WASM conn's closeWrite can otherwise beat the
        // frame bytes onto the wire.
        await this.#conn.write(encodeFrame(OP_CLOSE, frame.payload));
        await this.#conn.closeWrite();
      } catch {}
    }
    this.#fireClose({ code, reason, wasClean: true });
  }

  // fail tears the socket down and fires onerror plus onclose(1006),
  // unless the closing handshake already completed the connection.
  #fail(err) {
    this.readyState = TunnelWebSocket.CLOSED;
    this.#conn.close();
    if (this.#closeFired) return;
    this.#closeFired = true;
    if (!this.#sentClose && this.onerror) this.onerror(err);
    this.onclose?.({ code: 1006, reason: "", wasClean: false });
  }

  #fireClose(event) {
    this.readyState = TunnelWebSocket.CLOSED;
    if (this.#closeFired) return;
    this.#closeFired = true;
    this.#conn.close();
    this.onclose?.(event);
  }
}
globalThis.TunnelWebSocket = TunnelWebSocket;
