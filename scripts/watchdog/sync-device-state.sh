#!/bin/bash
# Empuja el estado de todos los equipos al eeePC para su monitor de tty1.
#
# POR QUÉ DEL HP HACIA EL EEEPC: el eeePC no tiene clave SSH para el router y mi
# harness bloquea tocar rutas de claves, así que no puedo provisionarla desde
# aquí. El HP ya alcanza a todos, así que recolecta y empuja. Dirección única,
# sin dependencias nuevas.
#
# COSTE: un scp de ~1 KB cada minuto. Despreciable incluso en un Atom N270.
set -u
STATE=/home/ricardo/.local/share/gentle-watchdog/device-state.txt
REMOTE=telfmng@192.168.2.30:/var/log/gentle-monitor/device-state.txt

# El fichero destino es de root; se escribe donde telfmng puede y el servicio
# del monitor lo lee desde ahí. Ruta escribible por el usuario:
DEST=/home/telfmng/device-state.txt
REMOTE_DEST=telfmng@192.168.2.30:$DEST

# 1. Recolectar
/usr/bin/python3 /home/ricardo/.local/share/gentle-watchdog/collect-devices.py --quiet || exit 1

# 2. Empujar (fallo silencioso: si el eeePC está apagado, el siguiente ciclo lo hará)
scp -q -o BatchMode=yes -o ConnectTimeout=6 "$STATE" "$REMOTE_DEST" 2>/dev/null || exit 0
exit 0
