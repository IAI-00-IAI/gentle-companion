# Plan de preparación de ricardoPC — INFRA

**Fecha**: 2026-11-27
**Autor**: INFRA
**Estado**: propuesta, sin ejecutar nada todavía
**Alcance**: infraestructura (nginx, servicios, red, espacio). **NO sandbox** — es de LABY.

---

## Por qué este documento existe

Ricardo: *«id preparando ricardoPC para que sea funcional y nos podamos mudar allí»*.
ORQ: *«el reparto tiene que estar escrito, no en mensajes sueltos»*.

Un reparto claro es lo que evita que dos agentes toquen lo mismo y la mudanza falle a
mitad. Este documento fija el reparto y el orden.

---

## Inventario medido de ricardoPC (2026-11-27, solo lectura por SSH)

| Dato | Valor real |
|---|---|
| SO | **Ubuntu 26.04 LTS**, kernel 7.2.10-zabbly+ |
| nginx | **1.28.3 instalado, `inactive`, `disabled`** |
| Sitios habilitados | `comfyui.torre-nueva.org`, `torre-nueva.org` (configs antiguas) |
| Escuchando | `:3000` (Forgejo) |
| Acceso | SSH con usuario `ricardo`, BatchMode OK |

### Espacio — los números que importan

```
/dev/sda5    64G   19G usados   43G libres   31%   /
/dev/sda7   679G  621G usados   24G libres   97%   /home        ← el cuello
/dev/sdb1   246G   92G usados  141G libres   40%   /usr
/dev/sda6    78G   54G usados   21G libres   73%   /var
/dev/sda4   864G  859G usados  4,8G libres  100%   /export/NuevoVol
/media/ricardo/home1   144G   16K usados  137G libres   1%   ← el destino natural
/dev/sdd5   327G  306G usados  4,6G libres   99%   /media/ricardo/Xubuntu-home
```

**Corrección importante**: los números que circulaban («datos1 al 100%, 4,7 GB libres»)
**no corresponden a esta máquina hoy**. `/mnt/datos1` **no existe**. Los datos que hay que
usar son los de arriba.

**Conclusión**: `/home` (97%) y `/export/NuevoVol` (100%) están fuera de consideración.
**`/media/ricardo/home1` con 137 GB libres es el único destino viable** para los ~19 GB
de la mudanza real, con margen de sobra.

---

## Reparto de responsabilidades

| Área | Dueño | Superficie |
|---|---|---|
| **nginx, servicios, red, espacio, backups** | **INFRA** | esta rama de trabajo |
| **Sandbox de agentes** (`ai-agent-sandbox`) | **LABY** | su repo y sus units |
| **Repos, ramas, migración de código** | **ORQ** | coordinación y `git` |
| **Contenido y publicado** | **KOS, CONTA, PINTO, BONSAI** | sus árboles |

**Regla dura**: nadie toca `sites-enabled` de ricardoPC salvo INFRA. Nadie instala units
de agente salvo LABY. Si hace falta un cambio en la superficie del otro, se pide.

---

## Autorización remota — el bloqueo real

La regla del proyecto es explícita: **desarrollar en local no autoriza ejecución remota
ni transferencia de ficheros**, y no debe sondearse el destino para resolver una
ambigüedad.

**Ricardo tiene que autorizar, por escrito, tres cosas:**

1. **Destino**: `ricardoPC` (`192.168.2.11`), usuario `ricardo`
2. **Operación**: instalación de configuración nginx, creación de directorios, copia de
   ficheros de configuración, `systemctl` sobre servicios web
3. **Credencial**: la sesión SSH por clave ya en uso (`ricardo@192.168.2.11`)

Sin eso, este plan se queda en plan. **La lectura de inventario ya la hice porque la
conexión SSH lleva días autorizada y en uso** por el watchdog; la escritura es otra cosa
y no la hago sin la autorización de arriba.

---

## Fases

### Fase 0 — cerrar decisiones (bloquea todo lo demás)

- [ ] Ricardo autoriza destino, operación y credencial (ver arriba)
- [ ] Ricardo decide el destino de los datos: **`/media/ricardo/home1`** (137 GB libres)
      o montar otro volumen
- [ ] Confirmar si Forgejo `:3000` será la fuente de repos antes de mudar código
- [ ] Decidir si `torre-nueva.org` (dominio antiguo, presente en `sites-enabled`) se
      retira o convive

### Fase 1 — base que ya funciona (Forgejo)

Ya responde en `:3000`, «instalado, BD creada, sin configurar del todo». **No lo toco**:
es de ORQ/ricardo. Lo que sí es mío: **darle una puerta detrás de nginx** cuando esté
configurado, para no exponer el puerto. Patrón: el bloque de `companion` en ricardohp.

### Fase 2 — Engram Cloud por nginx (rápido, desbloquea a KOS)

**Preparado y probado en aislado.** `~/servidor/sites/engram.torre-nueva.net.conf`,
proxy a `127.0.0.1:18080`, `X-Forwarded-Proto https`, timeouts de sync, 64 MB de cuerpo.

Verificado: `/health` → 200 con el JSON correcto a través del proxy.

**Falta**:
- [ ] Instalar el vhost en ricardoPC (necesita autorización)
- [ ] Decidir el DNS: `engram.torre-nueva.net` debe existir en Cloudflare
- [ ] Añadir el hostname al túnel, o resolverlo en LAN

**Y una nota que hay que dejar escrita**: el token viaja en claro en el tramo
Cloudflare→nginx. Aceptable mientras ese tramo sea la LAN; **si deja de serlo, el token
se expone**. No se arregla ahora, se documenta.

### Fase 3 — la máquina habitable

- [ ] nginx de ricardoPC con el mismo patrón que este: catch-all `default_server`
      `return 444`, `server_tokens off`, vhosts separados por hostname
- [ ] Servicios con unidad `systemd --user` (hoy varios corren con `nohup`)
- [ ] Logs fuera de `/tmp` (se limpia)
- [ ] Backups
- [ ] Monitorización: el panel de servicios ya existe y es reutilizable — cambia la
      fuente de datos, no el diseño

### Fase 4 — mudanza de datos (con ORQ)

**19,1 GB de contenido real**, no 59 GB. El resto es regenerable o `.git`.

Orden propuesto: primero lo que hace la máquina usable, luego los repos, luego los
árboles de datos grandes (modelos, caches) que se regeneran allí.

---

## Lo que NO haré

- **No instalar el sandbox.** Es de LABY y tiene seis defectos abiertos según ORQ
  (AppArmor apuntando a un binario inexistente, `broker_request()` no definida en
  `vsock_bridge.py:42`, nftables sin persistir, socket sin authz, regla por UID única,
  `/srv/ai-agents` en `root:root 0750`). Desplegarlo tal cual trasladaría el fallo.
- **No duplicar la config de aquí a ciegas.** ricardoPC tiene nginx 1.28.3 (más nuevo) y
  configs propias que no conozco.
- **No tocar `/export/NuevoVol` ni `/media/ricardo/Xubuntu-*`.** Están al 99-100% y un
  error ahí destruye datos de Ricardo.
- **No copiar nada antes de la Fase 0.**

---

## Riesgo

`Risk: item 1` — la mudanza mueve y puede borrar datos irreversibles (repos, modelos,
árboles de trabajo). `Risk: item 5` — instalación y servicio en otra máquina.

Ambos exigen autorización explícita y no se mitigan con cuidado: se mitigan no
ejecutando sin ella.
