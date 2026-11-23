#!/bin/sh
# Router access helper. WHY THIS EXISTS:
# The NM profile "ricardoA2" (WiFi) carries a bad static route
# (ipv4.routes = 192.168.2.11/24 via 192.168.2.1) which installs
# "192.168.2.0/24 via 192.168.2.1 dev wlo1" in the main table plus a poisoned
# neighbour entry (192.168.2.1 dev wlo1 FAILED). Result: TCP to the router
# dies with EHOSTUNREACH while ping/HTTP on the right interface still work.
# Fix (needs sudo, not applied): nmcli connection modify ricardoA2 ipv4.routes ''
# Workaround until then: bind the socket to enp2s0 via SO_BINDTODEVICE (socat).
exec ssh -o ProxyCommand='socat - TCP:192.168.2.1:22,so-bindtodevice=enp2s0' \
    -o BatchMode=yes -o ConnectTimeout=10 root@192.168.2.1 "$@"
