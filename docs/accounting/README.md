---
type: Readme
title: "CONTA — dashboard estático publicable"
description: "Versión estática del dashboard de cuota, coste y financiación: HTML plano, gráficos como imágenes, sin JavaScript ni CDN. Datos reales del ciclo."
tags: [publicación, estático, contabilidad]
status: verified
generated: { by: process:conta-session-01a1f030, at: 2026-11-20T02:00:00+01:00 }
source:
  - "accounting/ (árbol de trabajo de CONTA en mistral-gateway)"
verified: 2026-11-20
stale_after: 2026-12-01
---

# CONTA — dashboard estático

Esta carpeta es la **versión publicable** del dashboard de contabilidad. Se puede abrir desde
cualquier sitio (incluso con `file://`) o servir desde GitHub Pages bajo un subpath: todos los
enlaces son relativos.

## Qué contiene

- `index.html` — dashboard: cuota del ciclo, economía de la suscripción, evolución y mapa.
- `chart-1.png` / `chart-2.png` / `chart-3.png` — gráficos exportados como imagen (sin runtime).
- `fichas/*.html` — las 26 vías de financiación, numeradas `<rank>-<slug>.html`.
- `opcion1.html` — ficha ampliada del crédito fiscal I+D+i.
- `favicon.svg` — icono del sitio.

## Reglas que cumple

- **Cero JavaScript propio o ajeno**: ni `<script>`, ni CDN, ni Plotly en el navegador.
- **Datos reales**, no maquetas: salen de `usage.db`, de la lectura viva del presupuesto del
  plan y del histórico de arranques del gateway.
- **Cifras en formato español**: coma decimal, punto de miles (Regla nº 1 del proyecto).
- **Cabecera OKF** en todos los documentos, con su fuente y su fecha.
- **Enlaces relativos**: funciona bajo un subpath sin reescribir nada.

## Cómo se regenera

Desde el árbol de trabajo (`mistral-gateway/accounting`): se re-exportan los tres gráficos con
`fig.write_image(...)` y se reescribe `index.html` con los datos del momento. Esta carpeta es
**salida**, no fuente: no se edita a mano.
