# bridge/vendor — tailcat WASM distribution

Prebuilt artifacts of the tailcat browser client (`tailcatListen` /
`tailcatDial` globals), required by `bridge/app.js`:

- `main.wasm` — the js/wasm build of the tailcat web app
  (`GOOS=js GOARCH=wasm go build -o bridge/vendor/main.wasm ./web`,
  run from the tailcat repository at `/home/ricardo/Trabajo/IAI/tailcat`).
- `main.wasm.gz` — pre-gzipped copy of `main.wasm` for static hosts
  that cannot negotiate Content-Encoding; `app.js` decompresses it in
  the browser via `DecompressionStream`.
- `wasm_exec.js` — the Go WASM runtime glue, copied from
  `$(go env GOROOT)/lib/wasm/wasm_exec.js`.

These are binaries, not source; rebuild them after upgrading tailcat.
