# Modelo de seguridad

Gentle Companion expone deliberadamente menos capacidad que Pi mismo.

## Zonas de confianza

### Superficie de administrador local

127.0.0.1:43721

Solo para el administrador local. Puede crear invitaciones de emparejamiento, ver qué dispositivos emparejados están conectados, desconectarlos o revocarlos, cambiar los ajustes del daemon e inspeccionar todas las sesiones registradas.

No coloques este listener detrás de un túnel o proxy inverso.

No tiene credenciales, por lo que rechaza cualquier petición cuyo `Origin` no sea su propia dirección loopback (`http://127.0.0.1:43721`, `localhost`, `[::1]`) o una de las listadas en `PI_COMPANION_ALLOWED_ORIGINS`. Una página web de otro origen no puede abrir su WebSocket ni dirigir Pi.

### Superficie de dispositivos emparejados

127.0.0.1:43722

Pensada para funcionar detrás de un túnel HTTPS/WSS. Cada endpoint de control/datos requiere una credencial de dispositivo emparejado, excepto el endpoint de reclamación de emparejamiento único y la interfaz estática de emparejamiento.

Verificación estricta de `Origin`: las actualizaciones WebSocket y las peticiones POST/DELETE deben llevar un `Origin` igual a la dirección loopback del dispositivo, a la URL pública configurada o a una entrada de `PI_COMPANION_ALLOWED_ORIGINS`.

### Estado almacenado

Los dispositivos emparejados (nombre, agente de navegador, horas de emparejamiento y último avistamiento, y el hash SHA-256 de la credencial; nunca la credencial) y los ajustes se escriben atómicamente en `~/.pi/agent/pi-companion/state.json`. En Unix el directorio es 0700 y el archivo se crea 0600 antes de escribir cualquier byte.

### Automatizaciones

Solo la superficie de administrador local puede escribir scripts de automatización. Las herramientas de extensión nativas y MCP independientes usan esa superficie y no inician el daemon implícitamente. Los comandos usan argv sin shell implícito, pero tanto los comandos como los agentes Pi lanzados se ejecutan con los permisos del usuario del SO; esto no es un sandbox. Una sesión de automatización solo acepta respuestas a preguntas/cancelaciones de los navegadores. Los prompts, steering, comandos abort/plan/diff, subidas y borrado de archivos se deniegan en el servidor. Las ejecuciones fallidas o detenidas se conservan; las interrumpidas se marcan como fallidas al reiniciar el daemon.

### Interfaz web endurecida

Las respuestas HTML mantienen los scripts, estilos, fuentes y conexiones de la aplicación bajo la Content-Security-Policy existente, con `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` y `X-Content-Type-Options: nosniff`.

Los enlaces de agente abren una confirmación de vista previa, no un navegador del host. Solo se aceptan URLs HTTPS absolutas con nombres DNS de aspecto público para las vistas previas de sitios web; se rechazan credenciales, IP literales, nombres locales/reservados y el origen de Companion. Las vistas previas se muestran como instantáneas estáticas en un `srcdoc` con sandbox (scripts, red, formularios y navegación desactivados). Companion nunca copia su credencial de dispositivo emparejado en URLs de marco ni en documentos.

### Companion bridge

El puente permite a un dispositivo emparejado (o a la consola local) usar servidores localhost y archivos que el agente menciona. Está cerrado con llave varias veces: verificación de mención (la referencia debe aparecer en lo que la sesión produjo), comprobaciones de Origin estrictas, y revocación atómica de tokens. Las respuestas del proxy llevan `Content-Security-Policy: sandbox allow-scripts allow-forms allow-modals; frame-ancestors 'self'`, y las páginas enmarcadas no pueden leer el almacenamiento de Companion ni su credencial de dispositivo. `Cookie` y `Referer` no se reenvían upstream; las redirecciones se reescriben para permanecer dentro del puente. WebSockets y Web Workers no están soportados.

Los archivos recuperados deben ser archivos regulares dentro del límite de tamaño de subida y la lista de MIME permitida. Las ubicaciones habituales de credenciales (`.git`, `.ssh`, `.gnupg`, `.aws`, `.kube`, `.azure`, `.docker`, `.config/{gcloud,gh,git}`, `.env*`, `.netrc`, `.npmrc`, `.pypirc`, archivos de historial de shell, nombres de claves SSH, `*.pem|*.key|*.p12|*.pfx|*.kdbx|*.keystore|*.jks|*.tfstate|*.tfvars` y el propio directorio de datos del daemon) se omiten como red de seguridad best-effort. La copia se abre sin seguir un enlace simbólico final, el handle abierto se revalida contra la ruta canónica (mismo inode, ámbito y credencial), y la copia lee de ese handle con un presupuesto estricto de bytes.

### Pi bridge

Cada proceso Pi mantiene un WebSocket saliente hacia el daemon. El navegador no puede invocar herramientas de extensión arbitrarias. El conjunto de comandos permitidos es un protocolo cerrado.
