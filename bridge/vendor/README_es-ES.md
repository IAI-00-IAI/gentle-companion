# bridge/vendor — distribución WASM de tailcat

Artefactos precompilados del cliente de navegador tailcat (globales
`tailcatListen` / `tailcatDial`), necesarios para `bridge/app.js`:

- `main.wasm` — la build js/wasm de la aplicación web tailcat
  (`GOOS=js GOARCH=wasm go build -o bridge/vendor/main.wasm ./web`,
  ejecutado desde un checkout del repositorio
  [tailscale/tailcat](https://github.com/tailscale/tailcat) en el commit
  `e00cdde6f` (main, correspondiente a los artefactos incluidos)).
- `main.wasm.gz` — copia precomprimida con gzip de `main.wasm` para
  hosts estáticos que no pueden negociar Content-Encoding; `app.js` la
  descomprime en el navegador mediante `DecompressionStream`.
- `wasm_exec.js` — el pegamento del runtime WASM de Go, copiado de
  `$(go env GOROOT)/lib/wasm/wasm_exec.js`.

Son binarios, no código fuente; recompílalos tras actualizar tailcat.
