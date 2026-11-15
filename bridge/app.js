// Companion bridge. Plain JavaScript, no build step. The Go side
// (tailcat/web/main_js.go) exposes the globals tailcatListen and
// tailcatDial; this page wraps tailcatDial as window.bridge.dial for
// later tasks (HTTP-over-stream and WebSocket-over-stream shims).

let lastPublicOrigin = "";
const STORAGE_KEY = "companion-bridge.tunnel-addr";
const PORT_STORAGE_KEY = "companion-bridge.device-port";

const params = new URLSearchParams(location.search);
const verbose = params.has("verbose");

// canonicalDERPMapURL is the public tailcat DERP map, which allows
// cross-origin fetches with CORS headers.
const canonicalDERPMapURL = "https://tailcat.dev/derpmap.json";

// pickDERPMapURL returns the DERP map URL to hand to tailcatDial:
// the ?derpmap= query parameter if given, and otherwise a same-origin
// derpmap.json if the host serves one (e.g. when the bridge/ directory
// is copied to a static site that carries the map) or the canonical
// public map as fallback.
async function pickDERPMapURL() {
  if (params.get("derpmap")) {
    return new URL(params.get("derpmap"), location.href).toString();
  }
  const sameOrigin = new URL("derpmap.json", location.href).toString();
  try {
    const resp = await fetch(sameOrigin, { method: "HEAD" });
    if (resp.ok) {
      return sameOrigin;
    }
  } catch (e) {}
  return canonicalDERPMapURL;
}

const $ = (id) => document.getElementById(id);
const setStatus = (msg) => { $("status").textContent = msg; };
const showError = (msg) => {
  const el = $("error");
  if (msg) {
    el.textContent = msg;
    el.classList.remove("hidden");
  } else {
    el.textContent = "";
    el.classList.add("hidden");
  }
};

// countProgress wraps a stream, updating the page's progress bar as
// bytes pass through: loaded/total drives the bar, wireBytes is the
// transfer size shown to the user.
function countProgress(stream, total, wireBytes) {
  const ofMB = wireBytes > 0 ? ` of ${(wireBytes / (1 << 20)).toFixed(1)} MB` : "";
  const bar = $("load-progress");
  let loaded = 0;
  return stream.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      loaded += chunk.byteLength;
      if (total > 0) {
        bar.value = loaded / total;
        const pct = Math.min(100, Math.floor(100 * loaded / total));
        setStatus(`Loading WebAssembly… ${pct}%${ofMB}`);
      } else {
        setStatus("Loading WebAssembly…");
      }
      controller.enqueue(chunk);
    },
  }));
}

// fetchWasm fetches the wasm with load progress. Static hosts can't do
// Content-Encoding negotiation (and don't compress wasm), so they serve
// only the pre-gzipped vendor/main.wasm.gz, fetched raw here and
// decompressed in the page. Servers that negotiate don't serve that
// name; on 404 the plain vendor/main.wasm fetch below gets the
// negotiated encoding, which the browser decompresses itself.
async function fetchWasm() {
  const gz = await fetch("vendor/main.wasm.gz");
  if (gz.ok) {
    const size = Number(gz.headers.get("Content-Length")) || 0;
    const wasm = countProgress(gz.body, size, size)
      .pipeThrough(new DecompressionStream("gzip"));
    return new Response(wasm, { headers: { "Content-Type": "application/wasm" } });
  }

  const resp = await fetch("vendor/main.wasm");
  if (!resp.ok) {
    throw new Error(`fetching vendor/main.wasm: ${resp.status}`);
  }
  const total = Number(resp.headers.get("Content-Length")) || 0;
  const counted = countProgress(resp.body, total, total);
  return new Response(counted, { headers: { "Content-Type": "application/wasm" } });
}

// Boot the wasm module.
const ready = new Promise((resolve) => { globalThis.onTailcatReady = resolve; });
const go = new Go();
WebAssembly.instantiateStreaming(fetchWasm(), go.importObject)
  .then(({ instance }) => go.run(instance));
await ready;
$("load-progress").remove();
setStatus("Ready.");

// --- bridge surface ---

// window.bridge.dial(addr, port) dials one TCP stream to the daemon
// through the tailcat tunnel and resolves to a conn object:
//   { port, read() -> Promise<Uint8Array|null>, write(Uint8Array),
//     closeWrite(), close() }
// read is pull-based (null on EOF); closeWrite half-closes, netcat style.
window.bridge = {
  async dial(addr, port = 1) {
    if (!addr) {
      throw new Error("tunnel address is required");
    }
    const derpMapURL = await pickDERPMapURL();
    return tailcatDial({ addr, derpMapURL, port, verbose });
  },
};

// --- HTTP-over-stream shim (T2) ---

const { bridgeFetch } = await import("./http.js");
window.bridgeFetch = bridgeFetch;

// --- UI ---

// Restore the last used tunnel address and device port.
$("tunnel-addr").value = localStorage.getItem(STORAGE_KEY) || "";
const savedPort = localStorage.getItem(PORT_STORAGE_KEY);
if (savedPort) {
  $("device-port").value = savedPort;
}
$("dial-btn").disabled = false;

$("dial-btn").onclick = async () => {
  const addr = $("tunnel-addr").value.trim();
  const port = parseInt($("device-port").value, 10);
  if (!addr) {
    showError("Enter the tunnel address first.");
    return;
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    showError("Enter a valid device port (1-65535).");
    return;
  }
  localStorage.setItem(STORAGE_KEY, addr);
  localStorage.setItem(PORT_STORAGE_KEY, String(port));
  $("dial-btn").disabled = true;
  showError("");
  $("dial-status").textContent = "Dialing…";
  try {
    const conn = await window.bridge.dial(addr, port);
    // T2 smoke test: issue one real HTTP request over the tunneled stream
    // against a harmless daemon route and show the response status.
    $("dial-status").textContent =
      `Connected: tunneled stream open on device port ${conn.port}; ` +
      "probing daemon API…";
    try {
      const resp = await window.bridgeFetch(addr, port, "GET", "/api/settings");
      try { const s = resp.bodyJson(); if (s && s.publicUrl) lastPublicOrigin = new URL(s.publicUrl).origin; } catch {}
      $("dial-status").textContent =
        `Connected: GET /api/settings → ${resp.status} via tunneled stream ` +
        `on device port ${conn.port}.`;
    } catch (httpErr) {
      $("dial-status").textContent =
        `Connected: tunneled stream open on device port ${conn.port}; ` +
        `API probe failed: ${httpErr.message}`;
    }
  } catch (err) {
    $("dial-status").textContent = "";
    showError(`Dial failed: ${err.message}`);
  }
  $("dial-btn").disabled = false;
};

// Enable the WebSocket test once the page is ready (modules run after the
// DOM is parsed, so the elements already exist).
$("ws-btn").disabled = false;

// T3 smoke test: open a tunneled WebSocket to /ws/browser and report the
// handshake result. The token rides the token.<t> subprotocol, like the
// UI's live connection does.
$("ws-btn").onclick = async () => {
  const addr = localStorage.getItem(STORAGE_KEY) || "";
  const port = parseInt(localStorage.getItem(PORT_STORAGE_KEY) || "", 10);
  if (!addr) {
    showError("Dial a tunnel first.");
    return;
  }
  const token = $("ws-token").value.trim();
  const protocols = token ? ["pi-companion", "token." + token] : ["pi-companion"];
  $("ws-btn").disabled = true;
  $("ws-status").textContent = "Opening tunneled WebSocket…";
  try {
    const conn = await window.bridge.dial(addr, port);
    const ws = new window.TunnelWebSocket(conn, "/ws/browser", { protocols, origin: lastPublicOrigin });
    ws.onopen = () => {
      $("ws-status").textContent = "WebSocket open (readyState=1). Waiting for first frame…";
    };
    ws.onmessage = (e) => {
      const preview = typeof e.data === "string" ? e.data.slice(0, 120) : e.data.byteLength + " bytes";
      $("ws-status").textContent = "WebSocket open; first frame: " + preview;
      ws.close();
    };
    ws.onerror = () => {
      $("ws-status").textContent = "WebSocket error.";
      $("ws-btn").disabled = false;
    };
    ws.onclose = (e) => {
      if (!$("ws-status").textContent.startsWith("WebSocket open;")) {
        $("ws-status").textContent = "WebSocket closed: code=" + e.code + (e.reason ? " " + e.reason : "");
      }
      $("ws-btn").disabled = false;
    };
  } catch (err) {
    $("ws-status").textContent = "";
    showError("WebSocket test failed: " + err.message);
    $("ws-btn").disabled = false;
  }
};
