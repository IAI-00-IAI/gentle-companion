# Pi Companion promo video (vídeo promocional)

El recorrido narrado de ~2 minutos en [`docs/pi-companion-promo.mp4`](../../docs/pi-companion-promo.mp4), compuesto en Rust con [fframes](https://github.com/dmtrKovalenko/fframes). Las imágenes son reales: una sesión real de Pi en un terminal y la UI real de Companion en ventanas Chromium de tamaño escritorio y teléfono, dirigidas contra un daemon aislado. fframes enmarca las imágenes y añade subtítulos, overlays de puntero y tap, narración, música y efectos de sonido. Las esperas (Pi trabajando, una automatización en ejecución) se aceleran y se etiquetan como tales.

Escenas: iniciar una sesión → `/remote-control` → emparejar un dispositivo desde el panel → introducir el código en el teléfono → inspeccionar la sesión y enviar un prompt → responder la pregunta de Pi → crear una automatización de investigación → ejecutarla y revisar el historial de ejecución.

Requiere Rust, ffmpeg y las librerías de sistema del README de fframes (macOS: `brew install pkg-config ffmpeg x264 x265 opus nasm ninja`), más `pi`, `tmux`, `asciinema`, `agg` y Playwright para la grabación. El backend por defecto es Skia sobre Metal.

## 1. Grabar las imágenes

```bash
npm run ui:build && cargo build --release --manifest-path server/Cargo.toml
PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs node tools/promo-video/capture/record.mjs
python3 tools/promo-video/capture/cut.py
```

`record.mjs` escribe `captures/` (frames de screencast, el cast del terminal y un log de eventos con cada tap y pulsación de tecla). `cut.py` lo corta en `clips/*.mp4` y genera `src/cues.rs`, de modo que los overlays y efectos de sonido caigan sobre las interacciones grabadas. Ambas carpetas están git-ignored; regrábalas para cambiar las imágenes.

## 2. Renderizar

```bash
cd tools/promo-video
cargo run --release -- timeline                 # escenas y tiempos
cargo run --release -- strip Session -n 8       // hoja de contactos de una escena
cargo run --release -- preview 0s               # ventana de vista previa en tiempo real
cargo run --release -- render -o ../../docs/pi-companion-promo.mp4
```

## Sonido

- Narración: `audio/voiceover.py` genera `media/vo_*.wav` con texto-a-voz de OpenAI (`gpt-4o-mini-tts`, necesita `OPENAI_TOKEN` u `OPENAI_API_KEY`). El script contiene el texto; `voice()` en `src/lib.rs` coloca cada línea en su escena.
- Música y efectos de UI (taps, pulsaciones, whooshes, campanillas) se sintetizan en `audio/generate.py` a partir de osciladores y ruido, así que son originales y libres de regalías.

```bash
python3 audio/voiceover.py                      # regenerar la narración
python3 audio/generate.py                       # regenerar media/music.mp3 y los WAV de efectos (numpy, ffmpeg)
cargo run --release -- audio analyze            # apuntar a unos -14 a -16 LUFS, pico real cerca de -1 dBTP
```

Fuentes en `media/`: Inter y JetBrains Mono (SIL Open Font License).
