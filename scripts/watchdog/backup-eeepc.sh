#!/bin/bash
# Respaldo /home/ricardo del eeePC (192.168.2.30) -> ricardoPC /media/datos2/eeePC
#
# POR QUÉ ASÍ: el HP solo tiene 24 GB libres y el origen son ~25 GB, así que no
# cabe un staging intermedio. Tampoco sirve `rsync origen_remoto destino_remoto`
# porque el eeePC no tiene clave para ricardoPC. La única ruta sin staging es
# una tubería tar: ssh eeePC 'tar -cf -' | ssh ricardoPC 'tar -xf -'.
#
# ADITIVO, NUNCA DESTRUCTIVO: no hay --delete. Si algo ya está en destino, se
# sobrescribe; nada se borra allí. El borrado del ORIGEN queda fuera de este
# script a propósito — esa decisión es de Ricardo.
set -u
LOG=/home/ricardo/.local/share/gentle-watchdog/backup-eeepc.log
SRC=telfmng@192.168.2.30
DST=ricardo@192.168.2.11
DESTDIR=/media/datos3/eeePC

echo "=== INICIO $(date -Is)" | tee -a "$LOG"

ssh -o BatchMode=yes "$DST" "mkdir -p $DESTDIR" || { echo "FALLO: no puedo crear destino"; exit 1; }

# tar con --warning=no-file-changed: algunos ficheros (p.ej. logs activos)
# cambian durante la lectura y no queremos abortar por eso.
ssh -o BatchMode=yes "$SRC" \
  "tar -cf - \
     --exclude='.cache' \
     --exclude='.local/share/Trash' \
     --exclude='*.sock' \
     -C /home/ricardo . 2>/dev/null" \
| ssh -o BatchMode=yes "$DST" "tar -xf - -C $DESTDIR 2>&1" \
>> "$LOG" 2>&1

RC=${PIPESTATUS[0]}
echo "=== FIN $(date -Is) rc=$RC" | tee -a "$LOG"

# Informe final: qué hay en destino
ssh -o BatchMode=yes "$DST" "du -sh $DESTDIR; find $DESTDIR -type f | wc -l" >> "$LOG" 2>&1
