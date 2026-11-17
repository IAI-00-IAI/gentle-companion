# HTTPS para el cliente de Companion (app instalable)

El cliente de Companion se sirve por HTTP simple por defecto. Los navegadores solo
exponen un **contexto seguro** —service workers, Cache API y apps web instalables—
sobre HTTPS, así que un teléfono que abre el daemon por su IP de LAN solo puede
"instalar esta página web", no la app. Este documento explica cómo habilitar HTTPS y
qué resuelve y qué no.

## Por qué un puerto dedicado

`tailcat serve` siempre reenvía las conexiones del túnel a `127.0.0.1:<puerto de
dispositivo>` en **HTTP simple**. Por eso el daemon corre un listener espejo en
loopback sobre el puerto de dispositivo: el camino del túnel debe seguir en HTTP simple
o el túnel se rompe.

HTTPS vive por lo tanto en **su propio puerto**, junto a la superficie HTTP:

| Superficie | Puerto por defecto | Protocolo | Para qué |
| --- | --- | --- | --- |
| Superficie de dispositivo | `43722` | HTTP | Acceso por LAN y túnel tailcat |
| Superficie HTTPS | `43723` | HTTPS | App instalable (contexto seguro) |

El cliente prefiere el camino que funcione: LAN directa, HTTPS cuando está configurado,
y el túnel cuando el daemon no es alcanzable directamente.

## Cómo habilitarlo

### Certificado autofirmado (lo más rápido)

    PI_COMPANION_TLS_SELF_SIGNED=1 gentle-companion-server

El daemon genera `<home de Companion>/tls/cert.pem` y `key.pem` en el primer arranque
(clave en modo `0600`), los reutiliza después para que la huella sea estable, e imprime:

    HTTPS            generated self-signed certificate
    Certificate      /home/vosotros/.pi/agent/pi-companion/tls/cert.pem
    SHA-256          33:13:29:34:8E:58:51:CA:...
    HTTPS surface    https://192.168.43.73:43723

### Tu propio certificado

    PI_COMPANION_TLS_CERT=/ruta/cert.pem PI_COMPANION_TLS_KEY=/ruta/key.pem gentle-companion-server

Ambas variables son obligatorias: definir solo una hace que el daemon se niegue a
arrancar y nombre la variable faltante, en lugar de servir HTTP en silencio mientras el
usuario cree que TLS está activo.

### Puerto

`PI_COMPANION_TLS_PORT` permite cambiar el puerto HTTPS. Por defecto es el puerto de
dispositivo más uno, así nunca choca con el túnel.

## Qué cubre el certificado

El certificado generado lista las direcciones que un cliente realmente marca:

- el host del bind, cuando es una dirección concreta;
- **las direcciones IPv4 de LAN de esta máquina**, cuando el bind es comodín (`0.0.0.0`);
- `localhost` y `127.0.0.1`, siempre.

Un bind comodín nunca se convierte en nombre del certificado. `0.0.0.0` es una instrucción
al kernel, no un host que un teléfono pueda escribir, así que un certificado que lo lleve
se rechaza por host incorrecto incluso después de confiar en la CA. El comodín se reemplaza
por las direcciones propias de la máquina. Si la máquina no tiene dirección no-loopback, el
certificado cubre solo loopback.

El certificado **se reutiliza** entre reinicios, así que el fingerprint queda estable. Borrá
`<data dir>/tls/` para forzar uno nuevo — necesario cuando cambia la dirección de LAN de la
máquina, porque el certificado viejo no nombrará la nueva.

## Confiar el certificado en el teléfono

Un certificado autofirmado muestra una advertencia y, más importante, **bloquea el
registro del service worker** hasta que se confía. Instalalo como CA:

**Android**

1. Copiá `cert.pem` al teléfono (o abrí `https://<ip>:43723/cert.pem` una vez que el
   daemon lo sirva).
2. Ajustes → Seguridad → Cifrado y credenciales → Instalar un certificado →
   **Certificado de CA** → elegí el archivo.
3. Recargá el cliente. Chrome ahora trata el origen como seguro y ofrece *Instalar app*.

**iOS**

1. Abrí el archivo del certificado → *Permitir* → el perfil se descarga.
2. Ajustes → General → VPN y gestión de dispositivos → instalá el perfil.
3. Ajustes → General → Información → Ajustes de confianza de certificados → habilitá la
   confianza completa.

Compará la huella que imprimió el daemon con la que muestra el teléfono antes de confiar.

## Qué resuelve y qué no

**Resuelve**

- El cliente corre en contexto seguro: el service worker se registra, el shell de la app
  se cachea y el navegador ofrece *Instalar app*.
- Recargar la página fuera de la LAN funciona, porque el service worker sirve el shell
  desde caché y el túnel lleva los datos.

**No resuelve**

- El túnel en sí: sigue usando HTTP simple en el puerto de dispositivo, por diseño.
- Las advertencias de certificado si usás autofirmado y no lo confiás.
- Las transferencias binarias por el túnel (subidas y descargas) — siguen sin soporte.

## Verificar

    curl -k https://<ip>:43723/api/context     # la superficie HTTPS responde
    curl    http://<ip>:43722/api/context      # dispositivo y túnel siguen en HTTP simple

Ambas deben responder. Si el puerto HTTPS queda mudo, revisá el log del daemon: un
certificado que no se puede cargar se reporta al arrancar y la superficie HTTP sigue
funcionando.
