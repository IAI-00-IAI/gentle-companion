# REGISTRO DE PROYECTOS I+D (borrador para validación gestor — ContaMNG 18/19-nov-2026)

Criterio legal (art. 35 LIS): I+D = actividad creativa con INCERTIDUMBRE TÉCNICA
(novedad + no saber de antemano el resultado), no basta "es innovador".
Cada proyecto: objetivo, incertidumbre técnica específica, método, resultados esperados,
recursos, estado, período.

## P1 — Gateway OpenAI-compatible con transporte direct-first y fallback
- Objetivo: proxy local OpenAI-compatible que valide consumos, con failover entre cuentas
  (vibe/studio) y registro auditable de usage por request.
- Incertidumbre técnica: reproducir comportamiento exacto de API upstream (streaming con
  tool_calls, límites 429, formas de error heterogéneas) con 0 dependencias; política de
  reintento por cuenta que preserve orden y exclusividad en proxy de un solo proceso.
- Método: implementación iterativa con pruebas contra endpoints reales; técnicas de pool
  de claves con enfriamiento por motivo; fallback cassette; test de comportamiento con
  fallos de red (DNS, broken pipe) integrados en journalctl.
- Resultados esperados: 100% compatibilidad OpenAI-compatible con clientes de terceros
  (probado con clientes reales: pi, Open WebUI); failover sin intervención humana.
- Recursos: 1 desarrollador (personal técnico), suscripción Vibe (consumible I+D),
  hardware HP.
- Estado: EN PRODUCCIÓN (v1.0.7, 2026-11-16). Período de gasto: desde jul 2026.

## P2 — Dashboard contable en tiempo real (TUI + web) con datos de proveedor
- Objetivo: observabilidad de consumo y coste en vivo sin depender de endpoints que no
  reporten costes en €.
- Incertidumbre técnica: reconstruir costes a partir de registros con unidades distintas
  (% allowance, tokens, USD) y reconciliar con cuota viva del proveedor; acceso seguro a
  endpoints sin exponer claves.
- Método: módulo de datos único con fuentes tipadas (usage.db, read_quota, journalctl);
  rendering dual (rich/TUI + Plotly HTML); pruebas de render sin terminal.
- Resultados esperados: cuadro de mando completo en 2 vistas con datos reconciliados y
  trazabilidad de fuente.
- Recursos: 1 desarrollador, hardware HP.
- Estado: EN PRODUCCIÓN (nov 2026).

## P3 — Infraestructura de agentes autónomos multi-equipo (ODD/puente)
- Objetivo: coordinación de agentes con delegación segura (espera activa/evitaciones,
  atribución de trabajo por sesión).
- Incertidumbre técnica: protocolos de delegación con presupuesto/riesgo bounded;
  comunicación inter-sesiones con garantías de entrega.
- Método: agentes con instrucciones biteadas; verificación con sqlite independiente;
  auditoría inter-sesiones.
- Recursos: 1 desarrollador, suscripción Vibe (los agentes consumen vía gateway/gateway).
- Estado: EN PRODUCCIÓN (nov 2026).

## P4 — (CANDIDATO EN INVESTIGACIÓN) Acceso externo seguro al dashboard vía túnel
- Objetivo: acceso remoto seguro a datos de operación interna sin abrir puertos.
- Incertidumbre técnica: integración de tailcat con servidor local sin exponer LAN/superficie.
- Estado: INVESTIGACIÓN (nov 2026 — activo tras decisión del ORQ/Ricardo).

---

## FICHA DE GASTOS ELEGIBLES I+D (borrador — art. 35 LIS + AEAT; validar gestor)
- Personal técnico: horas del socio DESDE que exista nómina (sin nómina no se computa
  como personal técnico — registrar trabajo sin nómina para gasto no vale; LIMITACIÓN
  importante).
- Subcontratación a terceros (límite: 25% de la base para subcontratación a centros no
  dedicados; pareja — por confirmar en art. 35.3): p.ej. gestor especializado IMV. [draft]
- Suscripciones software afectas directamente (Vibe como consumible I+D de los agentes;
  otros servicios cloud): deducible como gasto del período, pro-rata si actividad mixta.
- Amortización de hardware afecto (HP; el equipo de ricardoPC si se dedica a I+D).
- NO elegibles: inmuebles, edificios; gastos de formación del personal (regímenes
  distintos — confirmar excepciones).
- LÍMITES DE SUBCONTRATACIÓN: "el gasto subcontratado no excederá del 25% de la base"
  (a validar en art. 35.2 LIS — si el gasto subcontratado ES a centros «dedicados a
  I+D», cuenta distinto).

## CALENDARIO FISCAL (verificado en fuente oficial AEAT/RD 1432/2003 — 18/19-nov-2026)
- Período fiscal natural: 1-ene → 31-dic. Ofrece ventaja mayor si se cierra bien.
- IMV Tipo a (ex post): se pide hasta 6 meses y 25 días tras cerrar el ejercicio.
- Aplicación de deducción: en el IS del ejercicio con incertidumbre ya resuelta y los
  gastos contabilizados.
- ABONO (cashback 80%): 1 año después del período que generó la deducción.
- Prescripción AEAT para verificar deducciones I+D: 10 años (art. 39.6 LIS).
