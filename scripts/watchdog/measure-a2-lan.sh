#!/bin/bash
# Mide la latencia del A2 por LAN y apaga su hotspot, en ese orden.
#
# POR QUÉ ESTE ORDEN: primero se mide con el hotspot aún encendido (estado real),
# se apaga, se vuelve a medir, y se comparan. Así el dato de "apagado" no depende
# de que el apagado haya funcionado: si el A2 deja de responder por 192.168.43.x,
# eso mismo confirma que el hotspot se apagó.
#
# El A2 se controla por adb sobre USB desde el eeePC, que es el enlace estable:
# el USB no depende de la WiFi que estamos a punto de tocar.
set -u
EEE="telfmng@192.168.2.30"
A2_USB_SERIAL="44fb3c0"

echo "=== 1. Estado de interfaces del A2"
timeout 25 ssh -o BatchMode=yes "$EEE" "adb -s $A2_USB_SERIAL shell ip -4 a 2>/dev/null | grep -E '^[0-9]+: |inet '" 2>&1 | head -12

echo
echo "=== 2. Latencia ANTES (hotspot encendido)"
timeout 30 ssh -o BatchMode=yes telfmng@192.168.2.30 \
  "ping -c 20 -i 0.2 192.168.43.245 2>&1 | tail -3"

echo
echo "=== 3. Apagando hotspot del A2"
timeout 25 ssh -o BatchMode=yes "$EEE" \
  "adb -s $A2_USB_SERIAL shell svc wifi disable 2>&1 | head -2" 2>&1

sleep 6

echo
echo "=== 4. Latencia DESPUES (hotspot apagado, por LAN si tiene)"
timeout 30 ssh -o BatchMode=yes telfmng@192.168.2.30 \
  "ping -c 20 -i 0.2 192.168.43.245 2>&1 | tail -3"

echo
echo "=== 5. Estado final de interfaces del A2"
timeout 25 ssh -o BatchMode=yes "$EEE" "adb -s $A2_USB_SERIAL shell ip -4 a 2>/dev/null | grep -E '^[0-9]+: |inet '" 2>&1 | head -12
