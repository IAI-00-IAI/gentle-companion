---
type: Rule
title: "REGLA #1 — formato numérico español (coma decimal, punto de miles)"
description: "Regla vinculante: separador decimal la coma, separador de miles el punto. Verificación obligatoria y doble/triple comprobación ante duda."
tags: [regla, formato, numeros, contabilidad]
status: verified
generated: 2026-11-19T21:30:00+01:00
source:
  - "Ricardo (instrucción directa, 19-nov-2026)"
verified: 2026-11-19
stale_after: 2027-06-30
---

# REGLA #1 — FORMATO NUMÉRICO ESPAÑOL (vinculante, no negociable)

> Fijada por Ricardo el 19-nov-2026. Rango: **REGLA #1**, por encima de cualquier otra
> convención de estilo. Aplica a TODO lo que ContaMNG produzca: informes, fichas,
> dashboards, mensajes, código con texto visible, tablas y gráficos.

## La regla

- **Separador decimal: la COMA.** `18,14 €` — nunca `18.14 €`.
- **Separador de miles: el PUNTO.** `255.000 €` — nunca `255,000 €`.
- Base actual del proyecto: **España**. El formato español es el correcto por defecto.
- El inglés (anglosajón) usa lo contrario. **No mezclar nunca los dos en el mismo documento.**

## Procedimiento obligatorio antes de publicar una cifra

1. **Determinar el formato de origen.** ¿La fuente es una API (suele ser anglosajón),
   una salida de comando, una web oficial española, o texto ya redactado?
2. **Convertir explícitamente** al formato español al redactar.
3. **Si hay cualquier duda: doble o triple verificación.** Ricardo lo pidió literalmente
   ("te lo repito MUY IMPORTANTE"). Una cifra mal formateada en contabilidad es un error
   grave: `1.500` puede leerse como mil quinientos o como uno coma cinco.


## El prefijo `k` SÍ es correcto (no confundir con el error)

`k` es un **prefijo del SI (kilo)** y está adoptado en España: `500 k€`, `25k`, `1,5M €`
son correctos y no ambiguos. Lo que NUNCA debe hacerse es **mezclar** el prefijo SI con el
separador de miles en la misma cifra: `500.000k` es un error (o `500 k€` o `500.000 €`).

## Qué NO se convierte (no son cifras decimales)

| Patrón | Ejemplo | Motivo |
|---|---|---|
| Artículos de ley | `art. 39.2 LIS`, `35.4`, `125.3` | Numeración legal, no decimales |
| Direcciones IP | `192.168.2.11`, `127.0.0.1` | Notación de red |
| Estándares / versiones | `802.11n`, `BlueZ 5.75`¹, `v1.0.7` | Identificadores |
| Salidas literales de comandos | `Band 1: 2412.0 MHz` | Cita textual de la fuente; no se reescribe |
| Fechas ISO | `2026-11-19` | Ya normalizadas |

¹ Las versiones de software sí pueden ir con coma si se presentan como cifra
(`BlueZ 5,75`); los estándares con nombre fijo (`802.11`) no.


## El guard es el SUELO, no la prueba

`check_number_format.py` detecta el error mecánico, pero **no sustituye la verificación
humana**. Antes de que una cifra se use para tomar una decisión, una persona la revisa.
Un script puede pasar y la cifra seguir siendo incorrecta en su contexto (unidad equivocada,
magnitud mal copiada, fuente que ya venía mal). Esa es la parte que Ricardo pide con
"doble o triple verificación": el script es el mínimo, no el argumento final.

## Verificación automatizada

`accounting/check_number_format.py` recorre los documentos y **falla** si encuentra un
decimal con punto que no sea IP, artículo de ley, estándar o cita literal.
Ejecutar al inicio de cada sesión y antes de informar cifras a Ricardo.

## Chequeo de arranque de sesión

Al comenzar cada sesión, ContaMNG debe:
1. Leer esta regla (está enlazada desde la memoria del proyecto, obs #887).
2. Ejecutar `python3 accounting/check_number_format.py` y `python3 accounting/check_okf.py`.
3. Reportar el resultado antes de dar cualquier cifra.
