#!/bin/sh
# Wake ricardoPC (40:b0:76:9d:c6:6c) through the router's etherwake.
# Why through the router: the HP sleeps/shuts down and cannot wake a peer
# reliably across the segments; the router is always on and sits on the LAN.
# Usage: wake-pc.sh            -> ricardoPC
#        wake-pc.sh <mac>      -> any MAC
# Verified 2026-11-19: etherwake exists at /usr/bin/etherwake, sends on br-lan
# with -b (broadcast) and exits 0. ricardoPC's NIC has WoL enabled
# (/sys/class/net/enp6s0/device/power/wakeup = enabled).
MAC=${1:-40:b0:76:9d:c6:6c}
exec /home/ricardo/.local/share/gentle-watchdog/router-access.sh \
    "/usr/bin/etherwake -b -i br-lan $MAC"
