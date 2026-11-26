# Servicios e informes en `dev.torre-nueva.net`

Cómo declarar un servicio, publicar un informe y qué se puede tocar. Para agentes.

## Las tres puertas

| Nivel | Dónde | Qué va ahí |
|---|---|---|
| **Público** | `torre-nueva.net` | Bienvenida y enlace al repositorio. Nada más. |
| **Interno** | `dev.torre-nueva.net` | Índices por agente, informes, documentación. **Solo LAN**: no está en el túnel de Cloudflare, así que desde fuera no existe. |
| **Nunca** | — | Pizarra del equipo, informes de cuota, ids de sesión, rutas de `$HOME`. No van en ninguna raíz web. |

La separación no es una convención: un nombre ausente de `/etc/cloudflared/config.yml` no existe desde Internet. Eso es lo que protege `dev.`, no un comentario.

## Declarar un agente

Un fichero por agente en `/home/ricardo/servidor/agents/<agente>.json`:

```json
{
  "agent": "conta",
  "title": "Contabilidad",
  "services": [
    {"name": "KOS kb", "unit": "kos-kb.service"}
  ],
  "entries": [
    {"date": "2026-11-25", "title": "Informe contable 1",
     "path": "/conta/informes/informe-1.html", "type": "html"},
    {"date": "2026-11-24", "title": "Previsión consumo mensual",
     "path": "/conta/informes/prevision.pdf", "type": "pdf"}
  ]
}
```

Campos obligatorios en cada entrada: **`date`**, **`title`**, **`path`**. `type` decide qué acciones aparecen.

Genera la página con:

```bash
python3 /home/ricardo/servidor/sites/gen-agent-index.py
```

Escribe `~/servidor/sites/dev/<agente>/index.html`. **No edites ese HTML**: se sobrescribe.

### Orden

Por `date`, **más reciente arriba**. Con la misma fecha se respeta el orden del fichero, así que puedes desempatar sin pelear con la herramienta.

### Tipos y acciones

| `type` | Ver | Descargar | Pestaña | Incrustado | Canvas |
|---|---|---|---|---|---|
| `html` | sí | sí | sí | sí | no |
| `pdf` | sí | sí | sí | sí | no |
| `md` | sí | sí | sí | no | no |
| `canvas` | sí | sí | sí | no | sí |
| cualquier otro | sí | sí | sí | no | no |

`Incrustado` solo aparece para lo que un navegador dibuja en un iframe. Un `.zip` incrustado es un rectángulo en blanco y parece roto.

Todas las acciones son enlaces reales y un `<details>` nativo. **No hay JavaScript** en las páginas generadas.

## Estados de servicio

El estado se **lee** de systemd, nunca se escribe:

| Estado | Significado |
|---|---|
| `active` | Corriendo |
| `inactive` | Existe y está parado |
| `missing` | **La unidad no existe** — revisa el nombre |
| `unknown` | No se pudo determinar |

`missing` existe porque `systemctl is-active` imprime `inactive` para una unidad que no existe. Se decide por **código de salida**: `0` activa, `3` parada, `4` inexistente. Un nombre mal escrito aparece como `missing`, no como un servicio parado.

## Pulsador: qué se puede tocar

- **Solo unidades `systemctl --user`.** Nada de `sudo`, nada de unidades de sistema.
- **Solo las de la lista blanca** en `TOGGLEABLE` dentro del generador. Cualquier otra unidad se rechaza con 403 y queda en el log.
- **Solo desde loopback.** No está publicado en `dev.` todavía.

### La limitación que hay que decir en voz alta

Mientras todos los agentes corran como `ricardo`, **el pulsador puede parar el servicio de otro agente**. La restricción «solo servicios secundarios» es una convención, no un control técnico. El control real llega con el sandbox por usuario (`ai-agent-sandbox`, en curso).

Por eso `pi-companion.service` **no está en la lista**: pararlo deja al equipo sin servicio, y un botón en una web no justifica ese poder.

## Añadir un servicio nuevo

1. Si es un proceso suelto, créale una unidad `systemctl --user`. Sin unidad no hay estado ni control.
2. Decláralo en el `services` de tu fichero `.json`.
3. Si quieres que sea controlable, propón añadirlo a `TOGGLEABLE` — y justifica por qué pararlo no rompe a nadie.
4. Ejecuta el generador.

## Rutas ya servidas

| Ruta | Origen |
|---|---|
| `/kos/` | `~/servidor/sites/kos/` (el mismo árbol que `:8420`) |
| `/conta/` | `gentle-companion/docs/accounting/` |
| `/pinto/canvas/` | proxy a `:42071` |
| `/<agente>/` | índice generado |

## Pendiente

- `dev.torre-nueva.net` **no está en nginx de producción** todavía: la config está validada en `~/servidor/sites/dev.torre-nueva.net.conf` y falta instalarla.
- El proxy del canvas devuelve **421** hasta que su lista de `Host`/`Origin` acepte `dev.torre-nueva.net`. Lo está tocando ORQ.
