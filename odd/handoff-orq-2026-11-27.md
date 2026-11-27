---
okf_version: "0.2"
type: Handoff
title: "ORQ — bitácora de cierre, ciclo 2026-11-25/27"
description: "Estado real del equipo, lo entregado, lo que sigue abierto y las decisiones tomadas en dos jornadas. Escrito para que el sucesor no dependa del transcript compactado ni repita lo aprendido."
tags: [handoff, coordination, bitacora, ciclo]
status: active
author: ORQ
generated: 2026-11-27
session: 01a1f3db
---

# ORQ — bitácora de cierre, ciclo 2026-11-25/27

> Dos jornadas. Lo que sigue no es un resumen de conversación: es el estado medido
> al cerrar, más las decisiones que no están en ningún otro sitio. Si algo de aquí
> contradice tu memoria del transcript, **gana este documento** — el transcript
> compactado pierde matices, esto no.

---

## 1. Estado de los servicios, medido al cerrar

| Qué | Estado | Puerto |
|---|---|---|
| **Daemon Companion** | `gentle-companion.service` **activo** | `:43721` → 200 |
| **kb de KOS** | **caído** al cerrar | `:8420` → 000 |
| **Forgejo** (ricardoPC) | activo, sin configurar | `192.168.2.11:3000` → 200 |
| **nginx** | tres sitios: `torre-nueva.net`, `companion.`, `ricardohp.` | `:80` |

**El kb de KOS se cae con cada reinicio del portátil** porque lo lanzo con `setsid nohup`
desde una sesión. No está en systemd. Si lo quieres permanente, necesita unidad —
y eso es de INFRA.

### El renombrado del servicio, hecho

```
gentle-companion.service   activo, habilitado
pi-companion.service       detenido, deshabilitado
```

El drop-in `10-origins.conf` se copió, así que **`ALLOWED_ORIGINS` sigue funcionando**
con las dos IPs y con `companion.torre-nueva.net`.

**Lo que NO se renombró, y por qué:**
- **Directorio de estado** `~/.gentle-shell/agent/pi-companion/` — se cambia en la mudanza
- **`PI_COMPANION_*`** (87 ocurrencias) — son contrato público: renombrarlas sin
  aceptar las dos rompe instalaciones existentes **sin error claro**
- **Subprotocolo WebSocket** `pi-companion` (`main.rs:1712` ↔ `companion.svelte.ts:74`) —
  cliente y servidor deben cambiar **juntos** o la conexión falla
- **Claves de `localStorage`** (`pi-companion-theme`, `-notifications`, `-sidebar`) —
  renombrarlas **borra las preferencias de todos**

---

## 2. Estado de los repos, medido al cerrar

| Repo | Rama | Sin commitear | Sin pushear |
|---|---|---:|---|
| `gentle-companion` | `feat/watchdog-health-board` | 3 | **5 commits, sin upstream** |
| `gentle-companion-aesthetic` | `feat/gentle-shell-aesthetic` | 4 | **30 commits** |
| `mistral-gateway` | `feat/accounting` | 0 | 0 |
| `a1-agent-sandbox-repo-kit` | `main` | 0 | 0 |
| `gentle-shell` | `feat/canvas-frame-ancestors` | 1 (`hunch/`) | 3 commits |
| `Lab` | `main` | 0 | sin remote |

**Ninguno se publicó.** Los 5 ficheros sin commitear son:
- `gentle-companion`: los dos README del borrado del vídeo + la lista de PINTO
- `aesthetic`: estado del canvas (`comments.json`, `handoffs.json`) + la tarea
- `gentle-shell`: `hunch/` sin trackear, **de origen desconocido** (SHELLY lo está mirando)

---

## 3. Lo entregado en estas dos jornadas

### El fallo que costó la tarde, y su causa real

Ricardo reportó **"HTTP 500 · Algo salió mal"** al refrescar con una pregunta pendiente.
Cuatro comprobaciones correctas y **ninguna respondía a la pregunta**:

| Lo que medí | Resultado | Por qué no servía |
|---|---|---|
| `curl` a las rutas | 200 en todas | El servidor no participaba |
| Log del daemon | vacío | Escribía a `/dev/null` |
| `pgrep` de procesos | un solo daemon | Correcto e irrelevante |
| Los 398 tests | verdes | Ninguno renderiza el componente |

**La causa estaba en la consola del navegador:**

```
ReferenceError: instant is not defined
at AskSheet.svelte:217 — {#if !instant}
```

PINTO eliminó la variable `instant` al arreglar el envío con un clic, y **dejó la
referencia**. El `{#if}` huérfano reventaba el componente al renderizar, SvelteKit
caía a `+error.svelte`, y `pageError()` lo presentaba como **500 "del espacio de trabajo"**.

**El mensaje de error mentía sobre su origen.** Corregido en `aesthetic`, y PINTO
escribió un guard que detecta nombres de plantilla sin declarar (analiza el **JS
compilado**, no la sintaxis fuente — 15 falsos positivos le costó el otro enfoque).

### Y una segunda causa, distinta

Hubo también **dos daemons peleando por el puerto 43722**: uno lanzado a mano que quedó
huérfano (PPID 1), y el del servicio. El segundo arrancó con:

```
WARN cannot bind the loopback device surface; Address already in use (os error 98)
```

**Y siguió arrancando con un `WARN`.** Un puerto ocupado debería ser fatal. Maté el
huérfano con permiso de Ricardo. **Pendiente: el supervisor debería comprobar el puerto
antes de lanzar.**

### El registro del daemon, que no existía

El supervisor lanzaba el daemon con `stdio: 'ignore'`, así que **todos los
`tracing::warn` se tiraban a la basura** — incluido el de `internal_error`, que escribe
`"request failed: {error}"` precisamente para esto.

**Arreglado:** ahora escribe a `~/.gentle-shell/agent/pi-companion/service/logs/daemon.log`.

Mi primera edición **no se aplicó** (el `assert` falló) y **di el arreglo por hecho**
porque `node --check` pasó — verificaba la sintaxis de un fichero que no había cambiado.
Mismo patrón que toda la semana: medir algo que no era la pregunta.

### El canvas: CSP configurable

Tres commits en `feat/canvas-frame-ancestors`, **rebasados por SHELLY sobre 165 commits
de upstream (v5.0.0)**. Hashes nuevos:

```
2635ea464  los tres cambios funcionales (con torre-nueva.net dentro)
fac8b4522  los mismos como CanvasPolicy configurable, default estricto
12a6e3ae3  la propuesta para Alan
```

**Los tres guards, porque relajar el CSP no basta:**
1. `frame-ancestors` — era `'none'`
2. Comprobación de `Host` — respondía 421 a todo lo que no fuera loopback
3. `ownOrigins` — daba 403 en POST

Configurable por entorno:
```bash
GENTLE_DESIGN_CANVAS_FRAME_ANCESTORS="https://torre-nueva.net"
GENTLE_DESIGN_CANVAS_SCRIPT_SRC="'unsafe-inline'"
```

**Sin definir: comportamiento idéntico al actual.** 554 tests del canvas + 91 de
gentle-design, 0 fallos.

**Lo que SHELLY encontró y bloquea proponerlo:** `ALLOWED_HOSTS` está **cableado en
`:24`** con `torre-nueva.net`, y `Host`/`ownOrigins` lo consultan. El CSP es
configurable pero los otros dos no — **un despliegue sin configurar seguiría aceptando
ese dominio**. Hay que derivarlos de la política antes de proponer.

**Y un dato que cambia el encuadre:** upstream v5.0.0 **ya tiene** una directiva
`frame-ancestors` relajada hacia loopback en `:691` (para artboards). Así que la
propuesta no es "abre esto", es **"extiende lo que ya hiciste, configurable"** —
mucho más fácil de aceptar.

### Los ocho agentes del equipo

| Agente | Sesión | Estado al cerrar | Su terreno |
|---|---|---|---|
| **ORQ** | `01a1f3db` | 66 % | coordinación |
| **INFRA** | `01a2093d` | 36 % | red, nginx, `server/` |
| **CONTA** | `01a1f030` | 30 % | contabilidad, cuota |
| **LABY** | `01a20385` | 26 % | KSCL, laboratorio |
| **PINTO** | `01a1f971` | **64 %** | UI, canvas |
| **SOFY** | `01a2117c` | ~50 %, **cerrada por saturación** | sandbox, `git` |
| **SHELLY** | `01a21998` | 6 % | revisor de gentle-shell |
| **BONSAI2** | `01a1f448` | **revivida hoy** | imágenes |
| **KOS** | `01a1f8b3` | idle | conocimiento |

---

## 4. Las decisiones tomadas

| Decisión | Quién | Estado |
|---|---|---|
| **`docs/accounting` → `.gitignore`** | Ricardo | **hecho** (`85ea75d`) |
| **Índice navegable: markdown + OKF** (propuesta A) | Ricardo | **hecho**, para INFRA |
| **Lazy load: 50 eventos, buffer anticipado** | Ricardo | especificado |
| **Forgejo = fuente, GitHub = copia** | Ricardo | **pendiente de ejecutar** |
| **LAN para dev e interna; público solo testimonial** | Ricardo | cerrado |
| **`server/` → INFRA, `git` → SOFY, `jsdom` → PINTO** | Ricardo | cerrado |
| **Autocompactación apagada** | Ricardo | **activo** — sin red |
| **Proveedor: DeepInfra, pruebas a final de mes** | Ricardo | preparado, inerte |
| **Tres niveles de exposición** | LABY | resuelto por red |

### Sobre la autocompactación apagada, y lo que implica

```
enabled: False
```

**No hay red.** Si una sesión crece sin que nadie prepare el relevo, **falla en vez de
compactarse**. Y el resumen genérico perdía justo lo que hace falta: qué se decidió y
por qué.

**Protocolo que Ricardo aprobó:** al hacer el handoff, **también un
`mem_session_summary`** — el documento en disco y la memoria indexada son dos cosas
distintas y hacen falta las dos.

**Y un umbral que propuse y no se fijó:** 60 % para empezar a escribir el handoff,
70 % para tenerlo cerrado. LABY añadió el matiz correcto: **lo que salva una sesión no
es el porcentaje, es tener los riesgos ya en disco.**

---

## 5. Lo que sigue abierto, por quién espera

### Espera a Ricardo

1. **Git flow** `main`/`dev`. Sin él, 29 commits de PINTO y 5 míos **no tienen destino**.
2. **Publicar gentle-shell** con la propuesta del canvas (él lo propone a Alan).
3. **`LAB-0006`** — el método de LABY, aprobado pero sin escribir.
4. **Dónde vive el códec** y qué significaba `L0..L5` (LABY y KOS).
5. **`image.dd`** — resuelto: era testdisk, borrado.

### En marcha

- **PINTO**: canvas con **todas** las 12 rutas, para que Ricardo señale en vez de describir.
  El espaciado sigue sin ser uniforme: Automatizaciones y Ajustes pasaron de bajos a altos
  tras `121fced`.
- **BONSAI2**: perfiles 2.5 con y sin proyector. El prioritario para imágenes es
  **`PTQ1-222k-V`, sin thinking** (más contexto = más imágenes).
- **SOFY (cerrada)**: bilingüe, polkit, sudoers. Handoff entregado.
- **SHELLY**: revisar el CSP antes de proponerlo; el bloqueante es `ALLOWED_HOSTS` cableado.
- **INFRA**: lazy load en `server/`, índice navegable, nginx por departamentos.

---

## 6. Los modelos locales, corregidos hoy

`models.json` tenía **desalineación con el `config.yaml` real en seis de ocho modelos**:

| Modelo | Antes | Ahora | Consecuencia del error |
|---|---:|---:|---|
| `bonsai-27B` | 102.400 | **262.144** | declaraba 61 % menos |
| `bonsaiTernary-27B` | 65.536 | **262.144** | declaraba 75 % menos |
| `bonsai2-Binary-27B` | 116.072 | **232.144** | la mitad |
| `bonsai2-BinaryL-27B` | **257.144** | **222.144** | **35k de más: falla en vez de compactar** |
| `bonsai2-TernaryL-27B` | 139.000 | 139.008 | ±8 |
| `bonsai2.5-*` (2) | — | añadidos | no existían |

**El `BinaryL` es el caso peligroso:** declarar más ventana de la que hay significa que
el cliente cree tener margen que no existe.

**Y un modelo fantasma:** `bonsai2-Ternary-27B` (91.072) **no existe en el config**.
Si alguien lo selecciona, falla. Pendiente de retirar o de encontrar dónde vive.

---

## 7. El patrón que se repitió toda la semana

**Cada fallo lo corrigió quien lo había escrito.** Conté ocho instancias en dos
jornadas:

| Quién | Qué afirmó mal | Cómo se corrigió |
|---|---|---|
| **CONTA** | ritmo de cuota con media de ventana | reconoció que documentó el error 2 h antes de cometerlo |
| **CONTA** | `load_plan()` arreglado, hermana sin arreglar | *"un defecto corregido en un sitio y no en sus hermanos no está corregido: está escondido"* |
| **SOFY** | `Qwen2.5-0.5B` de ~1 GB en la caché HF | **no existía**; lo citó de expectativa, no de `ls` |
| **SOFY** | "cero stashes" | eran **10** |
| **LABY** | "suites de test duplicadas" | **retirado**; un fichero huérfano sin importar `pytest` |
| **LABY** | `LAB-0003` a 0,46× "anómalo" | era **estructural**, no roto |
| **PINTO** | citó `11.CSBoRiwK.js` | **no existía** en ningún árbol |
| **ORQ** | exit code tras pipe | **cuatro veces**, la última verificando un guard ajeno |
| **ORQ** | `Testpaths` elevado a hallazgo | era falso: me fié de la confianza de otro |
| **ORQ** | "el TernaryL no ve" | **ve**; el que no lleva proyector es el BinaryL |
| **ORQ** | "el 500 es porque el modelo no ve" | el modelo **sí** veía; servía otro |

### Los cinco techos de la verificación

| # | Comprueba | No ve |
|---|---|---|
| 1 | **integridad** (hash, tamaño) | que el contenido sea cierto |
| 2 | **estructura** (paridad h1/h2/h3) | que un idioma nunca se actualizó |
| 3 | **paridad** | obsolescencia |
| 4 | **el registro** (`tasks.md`) | el estado real |
| 5 | **la salida** (exit code) | que la operación haya ocurrido |

**Un guard que solo comprueba presencia no protege.** Y un mensaje de error **no dice
dónde está el error**: el "HTTP 500 del espacio de trabajo" estaba en el cliente.

**El sexto, que apareció hoy:** el CSP del canvas y `ALLOWED_HOSTS` **no se hablan**. Un
sistema donde una parte es configurable y su hermana está cableada es un sistema que
acepta configuración y la ignora.

---

## 8. Lo que NO hacer, con el motivo

- **No verificar el exit code a través de un pipe.** Lo hice cuatro veces.
- **No fiarse de un mensaje de error para saber dónde está.** El 500 era del cliente.
- **No asumir que un fichero citado existe.** Dos veces esta semana; las dos de memoria.
- **No medir con la herramienta equivocada.** `du` vs `df`, `find` vs `ls`, `grep` vs `ps`.
- **No dejar trabajo funcionando sin commitear.** El `AskSheet` vivió en el árbol de
  trabajo hasta que PINTO lo commiteó: un cierre de sesión lo habría borrado.
- **No renombrar contrato público sin aceptar el viejo.** Las `PI_COMPANION_*` romperían
  instalaciones sin error claro.
- **No matar procesos sin permiso.** Ni el huérfano del daemon lo hice sin preguntar.
- **No dar un renombrado por hecho por compilar.** Mi edición del supervisor no se aplicó
  y `node --check` pasó igual.

---

## 9. Para el sucesor

**Tu primera tarea, si nada más importa: que el git flow exista.** Hay 34 commits
huérfanos entre dos ramas sin destino, y eso crece cada día.

**Y la segunda: revisar el kb de KOS.** Se cae con cada reinicio porque no está en
systemd. Es el patrón de este ciclo: **lo que no está automatizado desaparece.**

**Lo que no está en este documento y sí en Engram:** los hechos indexados, las
decisiones fechadas, y las observaciones de cada agente. **Los dos hacen falta** — el
documento tiene el juicio, Engram tiene la búsqueda.

**Y una cosa sobre el equipo, que es lo mejor de estas dos jornadas:** cuando uno se
equivocó, otro lo vio. Ocho veces. Si en tu ciclo nadie te corrige, sospecha.
