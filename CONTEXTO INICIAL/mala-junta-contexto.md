# MALA JUNTA — Documento de Contexto General

**Versión:** 2.0 · **Fecha:** 26 de julio de 2026 · **Autor:** Daniel (Project Lead) **Propósito:** Fuente de verdad del proyecto. Describe el negocio, el alcance y todos los requerimientos del software de gestión de Mala Junta. Se complementa con el documento "Plan Maestro de Desarrollo" (para el agente de código).

---

## 1\. Resumen ejecutivo

Mala Junta es un bar/discoteca en Colombia que vende bebidas alcohólicas (cervezas, licores en botella), aguas, gaseosas y combos. **Todo se vende por unidad completa** (no se manejan copas, shots ni cócteles). Se construirá un software de gestión integral que digitalice la operación:

- Toma de pedidos por meseros **desde su propio celular** (app web / PWA).  
- Pedidos en **tiempo real** hacia el **Centro de Mando** (caja, en PC/tablet) y hacia la **pantalla/impresora de barra**.  
- Cuentas por mesa y por cliente, división de cuentas, estados pagado/pendiente, fiados.  
- **Cierre de caja riguroso en la madrugada** con base, retiros justificados, conteo físico, cruce de faltantes/sobrantes y reseteo diario.  
- **Auditoría de inventario** como módulo separado: auditorías cortas, ajustes con motivo, kardex antifraude.  
- **Facturación DIAN-ready**: el sistema guarda desde el día 1 toda la estructura de datos exigida por la normativa colombiana (POS electrónico y factura electrónica), pero la **transmisión a la DIAN queda pospuesta** para una fase futura. Al cliente se le entrega un comprobante digital opcional por correo o WhatsApp.  
- Inventario **por unidad**, compras a proveedores con conversión caja→unidades, alertas de stock bajo.  
- Productos y **combos configurables** con precios editables e historial.  
- **Módulo de métricas** exclusivo del administrador \+ panel operativo limitado para caja.

**Stack decidido:** Supabase (PostgreSQL, Auth, Realtime, RLS, Edge Functions, Storage) \+ frontend web PWA, desarrollado con agente de código (Claude Code / Codex).

---

## 2\. Contexto del negocio

| Aspecto | Detalle |
| :---- | :---- |
| Tipo de negocio | Bar / discoteca |
| Productos | Cervezas, licores (botella completa), aguas, gaseosas, combos. **Sin cócteles ni venta por copas** |
| Personal de servicio | Lun–Mié: 1 mesero · Vie–Dom: 2 a 3 meseros |
| Canales de venta | Mesas, **barra directa** (sin mesero) y **zonas VIP** |
| Cover de entrada | No se maneja |
| Propina | Sugerida del 10%; el cliente puede modificarla o eliminarla |
| Medios de pago | Efectivo, datáfono, Nequi/Daviplata, transferencia. **El sistema solo registra el pago, no lo procesa** |
| Horario crítico | Operación nocturna que cruza la medianoche; el cierre ocurre en la madrugada |
| País / normativa | Colombia — DIAN (Resolución 000165 de 2023: factura electrónica y documento equivalente POS electrónico) |

---

## 3\. Roles y usuarios

| Rol | Dispositivo | Capacidades |
| :---- | :---- | :---- |
| **Administrador** | Web (PC/tablet/celular) | Acceso total: configuración, productos, precios, combos, usuarios, inventario, compras, auditorías, motivos estandarizados, aprobación de cierres descuadrados, módulo completo de métricas |
| **Caja (Centro de Mando)** | Web en PC/tablet | Pedidos en tiempo real, cuentas, pagos, división de cuentas, modificaciones/cancelaciones con motivo, apertura y cierre de caja, retiros de efectivo, envío de comprobantes, panel de métricas del turno |
| **Mesero** | Su propio celular (PWA) | Abrir cuentas (mesa/VIP/barra), tomar pedidos, enviarlos, consultar estado de sus cuentas y pedidos |

**Reglas de usuarios mesero (corrección clave):**

- El rol mesero es **único y uniforme**: todos los meseros tienen exactamente los mismos permisos. **No existen variantes ni sub-roles.**  
- Lo importante es la **creación exprés de usuarios**: desde el panel del administrador se crean usuarios "Mesero 1", "Mesero 2", "Mesero 3"… en segundos (nombre \+ PIN, nada más).  
- Acceso del mesero: **usuario \+ PIN de 4 dígitos**.  
- Los usuarios de mesero se pueden **desactivar** cuando la persona deja de trabajar (nunca se borran, para preservar el historial de ventas y auditoría).

---

## 4\. Requerimientos funcionales

### 4.1 Mesas, zonas y cuentas

- RF-01. Mapa/lista de mesas configurable (nombre, zona, capacidad).  
- RF-02. Zonas VIP: mesas marcadas como VIP (consumo mínimo/reservas quedan para fase futura).  
- RF-03. Canal "Barra": cuentas rápidas sin mesa asignada.  
- RF-04. Cuenta por mesa (compartida) o por cliente (varias sub-cuentas en una misma mesa).  
- RF-05. División de cuentas al cobrar: por ítems o en partes iguales.  
- RF-06. Estados: `abierta` → `por cobrar` → `pagada` / `pagada parcial` → `cerrada`; `anulada` solo con motivo.  
- RF-07. Transferencia de ítems o cuentas completas entre mesas.  
- RF-08. **Cuentas pendientes (fiado)**: una cuenta puede cerrarse la noche como `pendiente` con responsable identificado; **sobrevive al cierre de caja** y se salda otro día mediante abonos, que entran al efectivo (o medio) del turno en que se reciben.

### 4.2 Toma de pedidos (app del mesero)

- RF-09. Interfaz móvil rápida: búsqueda de producto, cantidad, notas opcionales, asignación a mesa/sub-cuenta.  
- RF-10. Al confirmar, el pedido viaja en tiempo real al Centro de Mando y a la barra (comanda).  
- RF-11. Estados de pedido visibles para el mesero: `enviado` → `en preparación` → `entregado`.  
- RF-12. **El mesero no puede modificar ni cancelar pedidos enviados.** Solo el Centro de Mando (caja o admin).  
- RF-13. Toda modificación/cancelación exige un **motivo estandarizado** (lista administrable: "cliente cambió de opinión", "producto agotado", "error de digitación", "producto en mal estado", etc.) y queda en log de auditoría inmutable con usuario y hora.

### 4.3 Barra

- RF-14. Vista de comandas en tiempo real (pantalla) y/o impresión térmica automática (ESC/POS).  
- RF-15. Marcar comandas como preparadas/entregadas.

### 4.4 Pagos

- RF-16. Pagos por cuenta con medios: efectivo, datáfono, Nequi/Daviplata, transferencia. Pagos mixtos permitidos.  
- RF-17. Propina sugerida 10%, editable/eliminable; se registra separada de la venta.  
- RF-18. Cálculo de cambio en efectivo.  
- RF-19. **Comprobante digital opcional**: al pagar, se le ofrece al cliente enviarle su comprobante por **correo o WhatsApp**; solo se envía si el cliente lo pide. No es obligatorio imprimir nada.

### 4.5 Módulo Cierre de Caja (dinero — módulo independiente)

Flujo obligatorio del ciclo de caja, diseñado para el cierre en la madrugada:

1. **Apertura con base inicial.** El ciclo comienza al inicio del turno: el cajero registra la "base" (efectivo con el que arranca para dar cambio). Sin base registrada, la caja no permite operar.  
2. **Retiros y gastos extraordinarios.** Toda salida de efectivo durante la noche (taxis, hielo de urgencia, almuerzo del personal, pagos a proveedores) **debe registrarse** en el módulo de retiros, con observación obligatoria y/o número de factura. Sin este registro, el cierre no cuadra.  
3. **Consolidación automática.** Al cerrar, el sistema calcula: `Efectivo esperado = base inicial + ventas en efectivo + abonos de cuentas pendientes recibidos en efectivo − retiros registrados`. El sistema totaliza además todo lo recaudado por otros medios (datáfono, Nequi/Daviplata, transferencia), pero **separa y muestra claramente el "efectivo de caja"**: el dinero físico que debe estar en el cajón.  
4. **Conteo físico obligatorio.** El cajero saca todo el dinero, cuenta billetes y monedas reales, y **digita el valor exacto contado**. El sistema no muestra el esperado antes de digitar el conteo (conteo ciego), para evitar cuadres "de oído".  
5. **Cruce final — faltantes y sobrantes.** El sistema compara conteo físico vs. efectivo esperado:  
   - **Faltante**: contó menos de lo esperado → dinero perdido.  
   - **Sobrante**: contó más de lo esperado → cobro errado a favor del bar o vuelto no entregado.  
   - **Si la diferencia es distinta de cero, el cierre requiere aprobación del administrador** (con su credencial) para ejecutarse; la diferencia y su eventual justificación quedan registradas.  
6. **Ticket de cierre y reseteo.** Aprobado el cruce, el sistema emite el ticket/reporte de cierre (digital, imprimible) como comprobante y **la caja queda en cero**: no arrastra ningún saldo. Al abrir el día siguiente, el proceso obliga a registrar una nueva base.

Notas:

- **Día de negocio ≠ día calendario**: la jornada termina en la madrugada. Todas las ventas de la noche pertenecen al mismo "día de negocio" (hora de corte configurable, propuesta: 6:00 a. m.).  
- Las **cuentas pendientes (fiado)** no bloquean el cierre: el efectivo cierra en cero y la deuda del cliente persiste como cartera (RF-08).

### 4.6 Productos, precios y combos

- RF-20. CRUD de productos: nombre, categoría, precio de venta, costo, impuestos aplicables, código interno, imagen opcional, activo/inactivo, stock mínimo.  
- RF-21. Precios configurables en cualquier momento; **historial de cambios de precio**.  
- RF-22. **Combos configurables**: N productos \+ precio propio (ej. "botella de aguardiente \+ 4 gaseosas"). Vender un combo descuenta cada componente por unidad.  
- RF-23. Categorías administrables.

### 4.7 Inventario y compras

- RF-24. **Descuento automático por unidad** en cada venta (una cerveza \= una botella; una botella de licor \= una unidad). **El inventario por puntos queda descartado**: no hay venta por copas ni fracciones.  
- RF-25. Movimientos tipados con kardex por producto: `venta`, `compra`, `ajuste` (motivo), `merma/rotura` (motivo), `consumo interno` (motivo), `abono/devolución`.  
- RF-26. Alertas de stock bajo por umbral configurable, visibles en Centro de Mando y panel admin.  
- RF-27. **Compras a proveedores con conversión de presentación**: el sistema permite registrar la compra **en cajas/paquetes con factor de conversión a unidades** (caja de 24 → suma 24 botellas al stock) **o directamente en unidades**. Cada producto puede tener definida su presentación de compra (ej. "caja x24", "paca x6") con su factor. La compra actualiza stock y costo unitario.  
- RF-28. CRUD de proveedores (nombre, NIT, contacto).

### 4.8 Módulo Auditoría de Inventario (módulo independiente del cierre de caja)

- RF-29. **Registro teórico automático**: gracias al descuento por venta, el sistema siempre conoce lo que "debería haber" en estantes.  
- RF-30. **Auditorías cortas (conteos parciales)**: el administrador selecciona un subconjunto de productos a auditar — típicamente los de **mayor valor o mayor rotación** — sin necesidad de contar todo el bar. El sistema sugiere candidatos por valor y rotación.  
- RF-31. Flujo de auditoría: el encargado cuenta el físico → digita cantidades → el sistema compara contra el teórico → muestra diferencias por producto.  
- RF-32. **Ajustes y bajas manuales**: las diferencias se resuelven registrando salidas justificadas con motivo estandarizado ("botella rota", "producto vencido", "consumo interno no registrado", "faltante sin justificar"). Cada ajuste queda en el kardex con empleado, fecha, hora y motivo.  
- RF-33. **Detección de patrones ("hormigueo")**: reporte histórico de diferencias por producto, por turno y por empleado, para que el dueño detecte faltantes recurrentes.  
- RF-34. Las auditorías son programables/repetibles (ej. 2–3 veces por semana para los productos caros); no están atadas al cierre de caja.

### 4.9 Facturación — estructura DIAN-ready, integración pospuesta

**Decisión de alcance:** el sistema debe quedar **estructuralmente listo** para la facturación electrónica colombiana, **sin conectar con la DIAN por ahora**. Objetivo: cuando se decida integrar, el proceso no sea traumático porque todos los datos, tablas y flujos ya existen.

Qué SÍ se implementa desde el día 1:

- RF-35. **Modelo de datos completo conforme a la Resolución 000165 de 2023**: tabla de documentos con tipo (documento equivalente POS electrónico, factura electrónica de venta, nota crédito, nota débito), consecutivos, datos del emisor (NIT, razón social, responsabilidades), datos del adquiriente, líneas con impuestos discriminados (IVA / INC / impoconsumo según parametrización del contador), totales, medio de pago, y campos reservados para CUFE/CUDE, XML y respuesta DIAN (vacíos por ahora).  
- RF-36. **Lógica del umbral de 5 UVT activa desde el día 1**: el valor de la UVT es un parámetro anual configurable; si la venta (antes de impuestos y propina) supera 5 UVT, el sistema **exige capturar nombre/razón social y cédula/NIT del cliente** y clasifica el documento como "factura de venta"; por debajo, lo clasifica como "documento POS". Así los datos quedan completos y correctamente clasificados para la futura transmisión.  
- RF-37. **Comprobante digital al cliente (no fiscal por ahora)**: representación gráfica del documento enviada opcionalmente por correo o WhatsApp (RF-19), claramente rotulada como comprobante interno mientras no exista habilitación DIAN.  
- RF-38. Gestión de consecutivos por tipo de documento, preparada para asociar en el futuro los rangos de numeración autorizados por la DIAN.  
- RF-39. El módulo de facturación se diseña **aislado** (servicio/Edge Function propio) con una interfaz clara `generar → firmar → transmitir → validar`, donde `firmar/transmitir/validar` quedan como stubs documentados.

Qué queda EXPLÍCITAMENTE pospuesto (fase futura de integración):

- Generación del XML UBL 2.1, firma digital XAdES, transmisión a los web services DIAN, CUFE/CUDE reales, habilitación del software en el ambiente de pruebas DIAN, rangos oficiales, notas crédito/débito electrónicas y modo contingencia.  
- Prerrequisitos administrativos del negocio: RUT como facturador electrónico, certificado de firma digital, set de pruebas.

### 4.10 Módulo de Métricas (exclusivo del administrador) y panel de caja

**Módulo Métricas — solo rol administrador** (no se manejan shots ni cócteles, por lo que se excluyen métricas de recetas/costo de cóctel):

*Rentabilidad y costos:*

- M-01. **Margen por presentación de compra**: rentabilidad real por producto cruzando costo de compra (caja→unidad) vs. precio de venta por unidad.  
- M-02. **Margen de utilidad global**: total invertido en compras a proveedores vs. total de ventas, con ganancia general del inventario por período.  
- M-03. Margen por producto y por combo (alerta cuando un cambio de costo de proveedor deteriora el margen).

*Inventario y rotación:*

- M-04. **Kardex detallado**: historial exacto de entradas/salidas con fecha, hora, empleado y motivo (incluye bajas y devoluciones).  
- M-05. **Tasa de rotación y días de stock** por referencia: qué tan rápido se vende y cuántos días cubre el inventario actual → cuándo volver a pedir.  
- M-06. Diferencias de auditoría acumuladas por producto/turno/empleado (antihormigueo, RF-33).

*Caja y flujo de dinero:*

- M-07. **Historial de cierres con faltantes y sobrantes** por día y por cajero.  
- M-08. **Reporte de retiros y gastos extraordinarios** totalizados y justificados por período.  
- M-09. **Reporte de propinas**: cuánto del ingreso diario no es del bar sino del personal, por período y por mesero.

*Personal y operación:*

- M-10. **Ventas por mesero** filtrables por día/semana/mes, discriminando contado vs. pendiente (crédito).  
- M-11. **Tiempos de preparación**: minutos entre el envío del pedido desde el celular del mesero y su marcación como entregado en barra (detección de cuellos de botella).  
- M-12. Ventas por día/rango (por día de negocio), por producto, por categoría, por franja horaria.

**Panel de métricas del rol Caja** (limitado al control del turno en curso — sin márgenes, costos ni rentabilidad):

- C-01. Efectivo esperado en cajón en tiempo real (base \+ ventas efectivo \+ abonos − retiros).  
- C-02. Ventas del turno por medio de pago.  
- C-03. Retiros del turno con sus justificaciones.  
- C-04. Propinas acumuladas del turno.  
- C-05. Cuentas abiertas y cuentas pendientes (fiados) vigentes.  
- C-06. Resumen previo al cierre (todo lo necesario para ejecutar el flujo de §4.5 sin fricciones).

### 4.11 Exportación

- RF-40. Todos los reportes y métricas exportables a CSV/Excel.

---

## 5\. Requerimientos no funcionales

- RNF-01. **Tiempo real**: ≤ \~2 s entre envío del pedido y su aparición en Centro de Mando y barra (Supabase Realtime).  
- RNF-02. **Resiliencia de red**: PWA del mesero con cola local de pedidos pendientes y reintento automático ante cortes breves; estado "pendiente de sincronizar" visible.  
- RNF-03. **Dispositivos**: PWA responsive; mesero en celulares Android/iOS de gama media; Centro de Mando en PC/tablet.  
- RNF-04. **Seguridad**: Supabase Auth (admin/caja con contraseña; mesero con usuario \+ PIN 4 dígitos); RLS por rol; acciones sensibles (anulaciones, ajustes, retiros, cambios de precio, aprobaciones de cierre) en log de auditoría inmutable; HTTPS; secretos solo en backend.  
- RNF-05. **Concurrencia**: picos vie–dom con 3 meseros \+ caja \+ barra simultáneos sin degradación.  
- RNF-06. **Usabilidad**: botones grandes, mínimo número de taps por pedido, flujo de cierre guiado paso a paso.  
- RNF-07. **Idioma/moneda**: español (Colombia), COP sin decimales en presentación.  
- RNF-08. **Trazabilidad**: nada se borra físicamente; correcciones \= registros nuevos con motivo.  
- RNF-09. **Comprobantes digitales**: envío por correo (SMTP/API) y WhatsApp (deep link `wa.me` con el comprobante, o API de WhatsApp Business en fase futura).

---

## 6\. Decisiones tomadas

1. Todo se vende por unidad completa; **inventario por puntos descartado**. ✔  
2. Rol mesero único, sin variantes; creación exprés de usuarios mesero con PIN 4 dígitos, desactivables. ✔  
3. Comprobante al cliente: **digital y opcional**, por correo o WhatsApp. ✔  
4. Lógica 5 UVT activa desde el día 1 (captura de cédula/NIT cuando aplique). ✔  
5. **Integración DIAN pospuesta**; estructura de datos y módulo aislado listos desde el inicio. ✔  
6. Cierre descuadrado requiere **aprobación del administrador**. ✔  
7. Fiados sobreviven al cierre de caja; se saldan con abonos. ✔  
8. Compras en cajas/paquetes con conversión a unidades **y** registro directo en unidades. ✔  
9. Panel de caja limitado a la operación del turno; rentabilidad exclusiva del admin. ✔  
10. Módulos independientes: **Cierre de Caja** (dinero) y **Auditoría de Inventario** (producto). ✔  
11. Supabase \+ agente de código (Claude Code / Codex). ✔

## 7\. Pendientes de negocio (no bloquean el desarrollo)

1. Parametrización tributaria exacta (IVA/INC/impoconsumo por producto) — validar con el contador.  
2. Hardware de barra: ¿pantalla (tablet) o impresora térmica desde el día 1?  
3. Hora de corte del día de negocio (propuesta: 6:00 a. m.).  
4. Lista definitiva de motivos estandarizados (modificación, anulación, ajuste, retiro).  
5. Cuándo iniciar los trámites DIAN (RUT facturador electrónico, certificado de firma digital) para la fase de integración.

## 8\. Referencias

- Interfija Soluciones — funcionalidades típicas de POS colombiano: [https://www.interfijasoluciones.com/](https://www.interfijasoluciones.com/)  
- Kosmo POS — patrones de POS offline y sincronización: [https://kosmopos.co/blog/gestion-y-operaciones/que-es-un-pos-offline/](https://kosmopos.co/blog/gestion-y-operaciones/que-es-un-pos-offline/)  
- Treinta — inventario de licores: presentaciones, puntos de pedido, auditorías cortas, rotación: [https://treinta.co/blog/inventario-licoreria-botellas](https://treinta.co/blog/inventario-licoreria-botellas)  
- Detrás del Bar — inventario por puntos (referencia descartada para este proyecto): [https://detrasdelbar.com/inventario-bebidas-por-puntos/](https://detrasdelbar.com/inventario-bebidas-por-puntos/)  
- DIAN — Resolución 000165 de 2023, anexos técnicos, Concepto 13246 de 2025, instructivos de habilitación: [https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/](https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/)

