---
type: Status Report
title: Estado verificado para la lista de Ricardo
description: "Lo que está hecho y probado, lo que está abierto con su motivo, y las decisiones que esperan. Escrito para consolidar antes de seguir, no para parchear."
status: active
author: "PINTO (agent, session 01a1f971)"
source: "gentle-companion-aesthetic/odd/estado-para-lista.md"
generated: 2026-11-23
---

# Estado verificado — para la lista

Ricardo: *"lo chequeo todo con tranquilidad y hago una lista detallada para no ir parcheando"*.
Esto es material para esa lista, separado por lo que está **cerrado y probado**, lo que está
**abierto con causa conocida**, y lo que **espera una decisión** que no es mía.

Rama `feat/gentle-shell-aesthetic`. Suite: **390 pass, 0 fail**. Árbol sin cambios pendientes.

---

## 1. Cerrado y verificado

| Commit | Qué resuelve | Cómo está probado |
|---|---|---|
| `ff1dadf` | Tableros de las dos decisiones estéticas (A1 ámbar, B1 trazo 2.0) | Servidos y revisados por Ricardo en el canvas |
| `a307a9f` | Cierre de los tableros con su estado | — |
| `4b634ac` | Paleta plum/rosa, identidad y set de iconos opacos | Iconos leídos como `opaque=true`; la regresión de transparencia era el fallo original |
| `42c80bf` | Panel lateral replegable, pulsando el título | 7 tests estructurales |
| `cba4647` | Tema e idioma como pulsadores cíclicos | Test que verifica el anuncio `aria-live`, no solo el giro |
| `058f091` | Las dos versiones de la marca, al muestrario | Board con el logo real y ambos orígenes en git |
| `5aa94b2` | Una tecla no puede convertirse en respuesta que no diste | 5 tests; cada guard probado reintroduciendo el defecto |
| `ac6f1d1` | El trigger del colapso ya no se oculta a sí mismo | Build limpio; el comentario del código explica el mecanismo |
| `5bde8c9` | Dos fuentes de reflow forzado eliminadas | **Sin medición**: ver §3 |

---

## 2. Abierto, con causa conocida

### 2.1 Coste del fondo de puntos (el que más pesa)
Medido, no estimado:

```
1400x900   →  32.625 celdas  →  1.83M ops por reconstrucción
1920x1080  →  53.565 celdas  →  3.00M
2560x1440  →  95.012 celdas  →  5.32M     ← monitor 2K
móvil      →   7.408 celdas  →  0.41M
```

`boxBlur` son 3 pasadas con 2 recorridos cada una y ~9 lecturas por celda, más `subjectMask`
y `paint` recorriendo todas. En un 2K son **5,3M operaciones por reconstrucción**.

**No lo he tocado** porque bajar la densidad cambia lo que se ve, y eso se acuerda antes.

### 2.2 Cola de mensajes (punto 16, junto al 28)
Retirar mensajes en espera. Comparte pregunta con el bug de concurrencia ya arreglado
(*¿qué gana si usuario y sistema actúan a la vez?*), por eso van juntos y no por separado.
Independiente del rendimiento: se puede hacer sin esperar a nada.

### 2.3 Aviso del bridge, en inglés
`src/git-changes.ts:124`, consumido por `src/bridge.ts:9`. Sigue hardcodeado.
**Bloqueado por una decisión**: ¿el `src/` raíz entra en alcance de traducción, o es texto
diagnóstico que se queda en inglés?

### 2.4 24 textos sin traducir
`TerminalPopup`, `AskSheet`, `AutomatedSessionBadge`. La redacción de Ricardo **ya está
transcrita** en `odd/copy-review-pinto.md` §E, sin aplicar. Bloqueado por:
**¿`Gentle-Shell` con guion o `Gentle Shell` sin guion?** Él escribe con guion; lo ya
commiteado dice sin guion. Si se mezclan, la misma pantalla muestra las dos grafías.

### 2.5 Unificación de "Pi" fuera del catálogo
`ui/src/routes/+layout.svelte:137` — meta description con *"your Pi sessions"*. Mismo criterio
que la corrección ya aplicada, pero fuera de ese bloque.

### 2.6 Peso de las variantes del logo
5,5 MB en `ui/src/assets/logo-alternatives/`. No van al bundle (nadie las importa), así que no
afectan al producto — solo al clon. Si pesan demasiado, reducirlas a 512px conserva su valor
documental.

---

## 3. Lo que NO está probado, dicho en voz alta

**El rendimiento no está medido.** `5bde8c9` elimina dos fuentes de reflow —una lectura de layout
por evento de puntero y un `ResizeObserver` que observaba contenedor y canvas a la vez— pero
**no he medido si los 648 ms desaparecieron**. El coste del `boxBlur` sigue ahí.

**No hay ningún test que detecte una regresión de rendimiento.** Por eso el mensaje del commit
dice "dos fuentes de reflow eliminadas", no "más rápido". Un mensaje feo y verdadero deja que el
siguiente construya encima; uno bonito y falso lo hace tropezar.

**El "atasco" de la pregunta no se reprodujo por separado.** El robo de foco con `autofocus` está
arreglado y probado, pero si el atasco persiste será otro defecto, y para distinguirlo hace falta
saber si el panel *no cierra* o *no responde a clics*: son causas distintas.

---

## 4. Decisiones que esperan, ninguna mía

| # | Pregunta | Bloquea |
|---|---|---|
| 1 | Fondo: ¿congelar al replegar (sin cambio visual) o perder densidad en pantallas grandes (se nota)? | §2.1 |
| 2 | `Gentle-Shell` con guion, o `Gentle Shell` sin guion | §2.4 |
| 3 | ¿El `src/` raíz entra en alcance de traducción? | §2.3 |
| 4 | Variantes del logo: ¿dejarlas a resolución completa o reducirlas? | §2.6 |
| 5 | Cola de mensajes: ¿ahora o en el siguiente lanzamiento? | §2.2 |

---

## 5. Y lo que sí conviene saber antes de hacer la lista

**Por debajo de 900 px el sidebar no existe.** Está `display: none` y hay una barra inferior
distinta. Cualquier expectativa de "replegar el panel" en ventana estrecha no aplica: ahí no hay
panel que replegar. Confundir eso con un bug costó varias rondas.

**Los breakpoints son contiguos** (`max-width: 900` y `min-width: 901`). No hay franja de un píxel
sin cubrir, aunque lo parezca.
