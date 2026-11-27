---
type: Session Log
title: "Bitácora de sesión de PINTO — estética, i18n y barra lateral"
description: "Registro verificado de lo que esta sesión construyó, lo que se rompió, lo que se midió contra el build equivocado y lo que queda abierto. Escrito antes de compactar para que la siguiente sesión lea esto en vez del transcript."
status: active
author: "PINTO (agent, session 01a1f971)"
source: "gentle-companion-aesthetic/odd/session-log-pinto_es-ES.md"
generated: 2026-11-27
---

# PINTO — bitácora de sesión

**Lee esto primero, no el transcript.** El transcript ocupa el 67 % de una ventana
de contexto y la mitad son callejones sin salida. Esto es lo que sobrevivió al
contacto con el código.

Rama `feat/gentle-shell-aesthetic`. 35 commits por delante de `origin/main`.
Suite: **399 pass, 0 fail**. `svelte-check`: **0 errores, 0 avisos**.

---

## 1. LO QUE HAY QUE SABER ANTES DE TOCAR NADA

### Un daemon puede servir un binario que ya no existe

```
pid 42049
exe -> .../gentle-companion-server (deleted)
```

El proceso se arrancó el 2026-11-26 a las 16:39. Recompilé, `cargo clean`
reemplazó el fichero en disco, y **el proceso siguió con el inode borrado
abierto**. Linux lo mantiene hasta que el proceso muere. Servía
`0.BR8Xzb2x.css`, un fichero que no existe en ningún sitio: `find /` no lo
encontrará jamás.

**Consecuencia:** toda medición tomada antes de reiniciar era contra el código
equivocado. Reporté "todas las páginas a 52px" desde ese daemon. Ricardo veía otra
cosa, y tenía razón.

**Comprobarlo antes de fiarse de cualquier medición:**

```bash
pid=$(ss -ltnp | grep :9911 | grep -oE 'pid=[0-9]+' | cut -d= -f2)
ls -l /proc/$pid/exe        # NO debe decir "(deleted)"
```

---

## 2. LO CONSTRUIDO

### i18n (ya integrado y publicado en 0.7.x)
- Un test que falla cuando falta una clave de la UI en el catálogo
- 36 claves ausentes añadidas, `en` + `es`
- Paginación y diagrama de automatizaciones traducidos (el diagrama necesitó dos
  frases completas, no una concatenación: en castellano cambia el género, "este
  paso" frente a "esta comprobación")
- 36 aria-labels, `Borrador`/`Listo` para Staged/Unstaged
- `Pi` dentro de frases se renderiza como `Gentle Shell`; `Pi-Jar` conserva su nombre

### Barra lateral
- Replegable pulsando la marca; el logo va dentro del pulsador
- La marca `✿` eliminada (Ricardo eligió "A, sin flor")
- Tema e idioma pasaron a pulsadores cíclicos con anuncio `aria-live`
- **El trigger llegó a ocultarse a sí mismo**: `.brand-text` era su único hijo y
  recibía `display: none`, dejando el botón sin área de pulsación. Ahora tiene
  objetivo de 40×40 y un chevron.

### Concurrencia del AskSheet
Ricardo: una pulsación se convirtió en una respuesta que nunca dio. La causa era
`autofocus` robando el cursor, más una vía de envío con un solo clic. Ahora:
retardo de 600 ms al abrir, sin autofocus, envío bloqueado hasta que asienta,
envío instantáneo eliminado.

### Cola de mensajes (comportamiento nuevo, no un arreglo)
El producto decía `Messages are not queued`: nunca se había construido. Un hueco,
`Alt+ArrowUp` para recuperarlo, envío automático al terminar el turno, indicador
visible.

### Logo
Rosa transparente para la barra lateral; el asset opaco para la portada (el campo
de puntos pinta tinta directamente cuando no hay alfa, así el fondo negro
desaparece solo y la rosa conserva todo su peso). EXIF, XMP y iTXt OKF preservados.

---

## 3. LO QUE SE ROMPIÓ, Y EN QUÉ ME EQUIVOQUÉ

**Mi commit `5aa94b2` arreglaba un bug real y creó otro.** Al eliminar `instant`
quedó `{#if !instant}` en el marcado. Nada lo cazó: el compilador lo aceptó,
`svelte-check` dio 0 errores, el build pasó, ningún test renderizaba el
componente. En ejecución lanzaba y SvelteKit mostraba un HTTP 500 que culpaba al
servidor del espacio de trabajo. El cliente tenía la culpa durante horas.

**El guard** (`5912832`) compila cada componente y busca `if (!name)` en el JS
emitido sin binding en esa salida. Analiza **el resultado compilado, no la sintaxis
fuente** — mi primer intento parseaba el fuente y produjo 15 falsos positivos
seguidos (props, runes, `{@const}`, params de snippet, `{#each}` con
destructuring). Probado mordiendo: reintroducir la guarda falla con
`lib/AskSheet.svelte: instant`.

**No commiteé el arreglo.** HEAD seguía con el bug mientras mi árbol tenía la
reparación. Detectado al diferenciar una entrada inesperada en `git status`.
Commiteado como `ada1221`.

**Medí contra el binario borrado** (sección 1) y reporté un arreglo que nunca se
verificó. La observación de Ricardo era más fiable que mi medición.

---

## 4. MAQUETACIÓN — el hilo largo, resuelto

Ricardo: los paneles y el espaciado difieren entre secciones.

**Ancho:** Ajustes era el único con `.narrow { width: min(920px, 100%) }`.
Eliminada. Ahora todas 1180 / 1116 interior / 32 de margen.

**Espaciado superior:** tres intentos, todos medidos:
1. `margin-top: 0` al primer hijo — sin cambio, el margen ya era 0
2. `:empty { display: none }` — sin cambio, `PullToRefresh` no está vacío
3. `.refresh-control { display: contents }` — sin cambio, seguía ocupando fila

**Causa real:** `PullToRefresh` era el primer hijo *dentro* de `.page`, así que
ocupaba una fila del grid y el hueco de 24px contaba antes de la cabecera
(28 + 24 = 52). Solo Sesiones y Automatizaciones lo tenían. **Arreglado de forma
estructural**: el componente salió fuera de `.page`, porque es un control del
contenedor, no contenido de la página.

Medido después, con el daemon bien recompilado: **28px en las seis páginas.**

---

## 5. CÓMO EJECUTAR LAS COSAS

```bash
# Tests — la suite completa, no solo el que tocaste
node --test --experimental-strip-types --no-warnings test/*.test.ts

# Comprobaciones estáticas — svelte-check ve errores de tipo y selectores
# muertos que la suite no puede ver
cd ui && npx svelte-check --fail-on-warnings

# Build de la UI
npm run ui:build

# Daemon en puerto privado (nunca tocar el 43721 del humano)
PI_COMPANION_ADMIN_ADDR=127.0.0.1:9911 PI_COMPANION_DEVICE_ADDR=127.0.0.1:9912   ./server/target/release/gentle-companion-server

# Recompilar el binario tras un cambio de UI — los assets van EMBEBIDOS
cd .. && cargo build --release --manifest-path server/Cargo.toml
```

**El binario embebe `web-dist/`.** Un cambio de UI sin recompilar Rust sirve los
assets viejos. Y un proceso viejo sirve un binario borrado en silencio.

---

## 6. ABIERTO, CON MOTIVOS

| Tema | Estado |
|---|---|
| 12 literales `Pi` incrustados en 5 componentes | Necesita 4 decisiones de redacción de Ricardo; lista en `odd/copy-review-pinto.md` §F |
| 5 etiquetas sin traducir en AskSheet (`confirm` entre ellas) | §G; una confirmación de seguridad debería decir qué autoriza |
| Lazy load del historial (punto 31) | Necesita decisión sobre la frontera de `server/` antes de escribir |
| Captura móvil del punto 38 | Pendiente; requiere viewport estrecho |
| Densidad de temas en 2K | Ricardo eligió "congelar al mover" ahora, densidad tras la mudanza |
| Sesiones archivadas | Funcionalidad nueva, a comentar con ORQ |

---

## 7. LO QUE NO PUDE VERIFICAR

- **La cola nunca se ha probado en un navegador real.** Los tests son
  estructurales. Cuatro casos necesitan una persona: escribir mientras responde,
  segundo mensaje rechazado, `Alt+ArrowUp` lo recupera, envío automático al
  terminar.
- **`Alt+ArrowUp` aún podría chocar** con un atajo del navegador en algún entorno.
  Era `Alt+ArrowLeft`, que es "atrás" y se lo comía el navegador.
- **No existe test de render para ningún componente.** `mount()` necesita DOM y no
  hay jsdom ni happy-dom instalados. Instalar uno es decisión de proyecto.

---

## 8. COMMITS Y DÓNDE VIVEN

La rama **sí está en el remoto** — `origin/feat/gentle-shell-aesthetic` existe en
`c44ee20`. Mi HEAD local es `2ffbffb`, **un commit por delante**. Las notas
anteriores que decían "35 commits sin copia fuera de este disco" eran falsas.

Sin subir, por instrucción: el push lo decide Ricardo.

---

## 9. CONVENCIONES QUE COSTARON TIEMPO

- **Los cambios de identidad se proponen, se acuerdan y luego se commitean.** Regla
  de Ricardo, tras aparecer un `✿` en un diff sin discutirlo.
- **Nada se borra.** Lo descartado va a `odd/assets/descartados/` con manifiesto;
  los borradores a `borradores/`. Ambas en gitignore, sus manifiestos no.
- **Todo artefacto lleva OKF.** Los PNG sidecar, el HTML un bloque de comentario
  antes de `<!doctype`, el markdown frontmatter. El campo `feature` debe ser una
  ruta real `odd/tasks/<nombre>.md` o el canvas avisa y lo ignora.
- **Una captura que existe no es una captura correcta.** Mide el estado que la
  imagen dice mostrar: una captura en blanco pesa pocos KB, una real cientos.
- **A Ricardo en castellano; entre agentes en inglés.**
