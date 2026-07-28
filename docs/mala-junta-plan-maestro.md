# MALA JUNTA — Plan Maestro de Desarrollo

**Versión:** 1.0 · **Fecha:** 26 de julio de 2026 **Audiencia:** agente de código (Claude Code / Codex). Este documento es el plan de ejecución técnica. El contexto de negocio completo está en `mala-junta-contexto.md` (léelo primero; sus RF/RNF/M/C son la especificación).

---

## 1\. Stack y principios

- **Backend:** Supabase — PostgreSQL (con RLS en todas las tablas), Auth, Realtime, Edge Functions (Deno/TypeScript), Storage.  
- **Frontend:** una sola aplicación **Next.js (App Router) \+ TypeScript \+ Tailwind**, instalable como **PWA**, con tres áreas por rol: `/mesero`, `/caja` (Centro de Mando), `/admin`. Vista `/barra` para comandas.  
- **Estado/datos en cliente:** cliente supabase-js \+ TanStack Query; suscripciones Realtime para pedidos/comandas/cuentas.  
- **Principios rectores:**  
  1. **La base de datos es la autoridad.** Reglas de negocio críticas (estados, cierres, kardex, consecutivos) viven en Postgres (constraints, funciones RPC, triggers), no solo en el cliente.  
  2. **Nada se borra.** Soft-delete/desactivación \+ tablas de auditoría append-only.  
  3. **Todo movimiento de dinero o inventario es un registro tipado** con usuario, timestamp y motivo cuando aplique.  
  4. **Módulo DIAN aislado** detrás de una interfaz `generar → firmar → transmitir → validar`; solo `generar` se implementa ahora, el resto son stubs documentados.  
  5. **Día de negocio**: función SQL `dia_negocio(timestamptz)` con hora de corte configurable (default 06:00 America/Bogota). Todos los reportes agrupan por día de negocio.  
  6. Español en UI; código e identificadores de BD en español simple y consistente (`snake_case`).

## 2\. Estructura del repositorio

mala-junta/

├── app/                      \# Next.js App Router

│   ├── (auth)/login

│   ├── mesero/               \# PWA mesero

│   ├── caja/                 \# Centro de Mando

│   ├── barra/                \# pantalla de comandas

│   └── admin/                \# administración \+ métricas

├── components/

├── lib/                      \# supabase client, helpers, tipos generados

├── supabase/

│   ├── migrations/           \# SQL versionado (fuente de verdad del esquema)

│   ├── functions/            \# Edge Functions (comprobantes, dian/)

│   └── seed.sql              \# datos de prueba

├── docs/

│   ├── mala-junta-contexto.md

│   └── dian-integracion-futura.md   \# se escribe en F4

└── tests/                    \# pruebas de funciones SQL críticas \+ e2e básicos

## 3\. Modelo de datos (migración inicial \+ incrementos por fase)

Convención: todas las tablas con `id uuid pk default gen_random_uuid()`, `created_at`, `updated_at`; FK explícitas; RLS habilitado.

### 3.1 Identidad y configuración

- `perfiles` — extiende auth.users: `nombre`, `rol` enum('admin','caja','mesero'), `pin_hash` (solo meseros, PIN 4 dígitos), `activo` bool. *El rol mesero es único: sin campos de permisos.* Función RPC `crear_mesero(nombre, pin)` para creación exprés por el admin; `desactivar_usuario(id)`.  
- `parametros` — clave/valor tipado: `uvt_valor_anual` (por año), `propina_sugerida_pct` (10), `hora_corte_dia_negocio` ('06:00'), datos del emisor (NIT, razón social, dirección, responsabilidades fiscales), plantillas de comprobante.  
- `motivos` — `tipo` enum('modificacion','anulacion','ajuste\_inventario','retiro\_caja'), `texto`, `activo`. CRUD solo admin.

### 3.2 Sala y cuentas

- `mesas` — `nombre`, `zona`, `es_vip` bool, `activa`.  
- `cuentas` — `mesa_id` nullable (null \= barra), `estado` enum('abierta','por\_cobrar','pagada\_parcial','pagada','pendiente','cerrada','anulada'), `dia_negocio` date (calculado al abrir), `abierta_por` (perfil), `responsable_pendiente` text (nombre/cédula del deudor cuando queda fiada), `cierre_caja_id` nullable.  
- `sub_cuentas` — `cuenta_id`, `etiqueta` ("Cliente 1", nombre). Los ítems referencian sub\_cuenta opcionalmente para división por persona.

### 3.3 Pedidos

- `pedidos` — `cuenta_id`, `mesero_id`, `estado` enum('enviado','en\_preparacion','entregado','anulado').  
- `pedido_items` — `pedido_id`, `producto_id` XOR `combo_id`, `sub_cuenta_id` nullable, `cantidad`, `precio_unitario_capturado`, `notas`, `estado`.  
- `modificaciones_pedido` (append-only) — `pedido_item_id`, `accion` enum('modificar','anular'), `detalle_antes` jsonb, `detalle_despues` jsonb, `motivo_id` NOT NULL, `usuario_id`, `timestamp`. Trigger: solo roles caja/admin pueden escribir; el mesero no tiene UPDATE sobre pedidos enviados (RLS).

### 3.4 Catálogo

- `categorias` — `nombre`, `activa`.  
- `productos` — `nombre`, `categoria_id`, `precio_venta`, `costo_unitario_actual`, `codigo_interno`, `imagen_url`, `activo`, `stock_actual` (mantenido por trigger desde kardex), `stock_minimo`, `presentacion_compra` text nullable ("caja x24"), `factor_compra` int default 1, campos fiscales: `tipo_impuesto` enum('iva','inc','impoconsumo\_licor','exento') \+ `tarifa_pct`/`tarifa_especifica` (parametrizables; validar con contador).  
- `historial_precios` (append-only) — `producto_id`, `precio_anterior`, `precio_nuevo`, `usuario_id`, `timestamp`.  
- `combos` — `nombre`, `precio_venta`, `activo`; `combo_items` — `combo_id`, `producto_id`, `cantidad`. Vender combo genera movimientos de inventario por cada componente.

### 3.5 Inventario y compras

- `movimientos_inventario` (kardex, append-only) — `producto_id`, `tipo` enum('venta','compra','ajuste','merma','consumo\_interno','devolucion'), `cantidad` (+/-), `referencia_tipo`\+`referencia_id` (pedido\_item, compra\_item, auditoria\_item), `motivo_id` nullable (NOT NULL para ajuste/merma/consumo), `usuario_id`, `timestamp`. Trigger actualiza `productos.stock_actual`.  
- `proveedores` — `nombre`, `nit`, `contacto`.  
- `compras` — `proveedor_id`, `fecha`, `total`, `usuario_id`; `compra_items` — `producto_id`, `modo` enum('unidades','presentacion'), `cantidad_ingresada`, `factor_aplicado` (1 si unidades; factor\_compra si presentación), `unidades_resultantes` (calculado), `costo_unitario`. Al confirmar: kardex tipo 'compra' \+ actualización de `costo_unitario_actual`.  
- `auditorias_inventario` — `fecha`, `usuario_id`, `estado` enum('en\_curso','cerrada'); `auditoria_items` — `auditoria_id`, `producto_id`, `teorico` (snapshot), `contado`, `diferencia` (calc). Al cerrar, cada diferencia ≠ 0 exige generar un movimiento tipo 'ajuste'/'merma'/'consumo\_interno' con motivo. Vista `v_candidatos_auditoria` sugiere productos por valor de inventario y rotación.

### 3.6 Caja y pagos

- `cierres_caja` — `dia_negocio`, `abierto_por`, `base_inicial`, `abierto_at`, `cerrado_por`, `cerrado_at`, `efectivo_esperado` (calculado al cerrar), `efectivo_contado`, `diferencia`, `aprobado_por` nullable (NOT NULL si diferencia ≠ 0, debe ser rol admin — constraint \+ RPC), `estado` enum('abierta','cerrada'), `ticket_url`.  
- `retiros_caja` (append-only) — `cierre_caja_id`, `monto`, `motivo_id` o `observacion` NOT NULL, `numero_factura` nullable, `usuario_id`, `timestamp`.  
- `pagos` — `cuenta_id`, `cierre_caja_id`, `medio` enum('efectivo','datafono','nequi\_daviplata','transferencia'), `monto`, `propina`, `es_abono_pendiente` bool, `usuario_id`, `timestamp`.  
- Regla dura (RPC `cerrar_caja`): calcula `efectivo_esperado = base_inicial + Σ pagos efectivo del ciclo (incluye abonos en efectivo) − Σ retiros`; exige `efectivo_contado` digitado antes de revelar el esperado (conteo ciego: el cliente solo llama `cerrar_caja(contado)` y recibe el cruce); si `diferencia ≠ 0` exige `aprobacion` (re-auth admin); genera ticket; marca cuentas cobradas del ciclo; **no permite abrir un nuevo ciclo sin nueva base**. Cuentas `pendiente` no bloquean el cierre.

### 3.7 Facturación DIAN-ready (sin transmisión)

- `documentos` — `tipo` enum('pos','factura\_venta','nota\_credito','nota\_debito'), `consecutivo` (por tipo, vía secuencias), `cuenta_id`, `emisor` jsonb (snapshot de parámetros), `adquiriente` jsonb nullable (`{razon_social, tipo_id, numero_id}` — NOT NULL cuando `tipo='factura_venta'`), `subtotal`, `impuestos` jsonb (discriminados por tarifa), `propina`, `total`, `medios_pago` jsonb, `dia_negocio`, y campos futuros vacíos: `cufe_cude`, `xml_url`, `respuesta_dian` jsonb, `estado_dian` enum('no\_transmitido','...') default 'no\_transmitido'.  
- Regla 5 UVT (función `clasificar_documento(subtotal)`): si `subtotal > 5 * uvt_vigente` → `factura_venta` y la UI exige datos del adquiriente; si no → `pos`. UVT parametrizable por año.  
- `envios_comprobante` — `documento_id`, `canal` enum('correo','whatsapp'), `destino`, `estado`, `timestamp`. Envío **opcional**, solo a solicitud del cliente.  
- Edge Function `comprobante/`: genera la representación gráfica (HTML→PDF) rotulada "comprobante interno — documento no fiscal" mientras `estado_dian='no_transmitido'`, y la envía por correo (Resend/SMTP) o produce link `wa.me` con acceso al PDF.  
- Carpeta `supabase/functions/dian/` con la interfaz `generarXML() / firmar() / transmitir() / validar()`: solo estructura y stubs con TODOs referenciando Resolución 000165 de 2023 y anexo técnico UBL 2.1.

### 3.8 Auditoría transversal

- `log_auditoria` (append-only) — `usuario_id`, `accion`, `entidad`, `entidad_id`, `detalle` jsonb, `timestamp`. Poblada por triggers en: anulaciones, ajustes, retiros, cambios de precio, aprobaciones de cierre, desactivación de usuarios.

## 4\. RLS (resumen de política por rol)

| Recurso | mesero | caja | admin |
| :---- | :---- | :---- | :---- |
| Cuentas/pedidos propios: crear, leer | ✔ | ✔ (todas) | ✔ |
| Modificar/anular pedidos enviados | ✖ | ✔ (con motivo) | ✔ (con motivo) |
| Pagos, retiros, cierre de caja | ✖ | ✔ | ✔ |
| Aprobar cierre descuadrado | ✖ | ✖ | ✔ |
| Catálogo, precios, combos, usuarios, parámetros | lectura | lectura | ✔ |
| Compras, auditorías de inventario | ✖ | lectura | ✔ |
| Métricas de rentabilidad (M-01…M-12) | ✖ | ✖ | ✔ |
| Panel de turno (C-01…C-06) | ✖ | ✔ | ✔ |

## 5\. Fases de desarrollo (orden de ejecución para el agente)

> Cada fase termina con: migraciones aplicadas, seed actualizado, pruebas de las funciones SQL críticas, y criterios de aceptación verificados manualmente.

### F0 — Fundaciones (1 sesión)

- Inicializar repo Next.js \+ Supabase local (CLI), CI básico, PWA shell, login (email/contraseña para admin y caja; usuario+PIN para mesero), tabla `perfiles`, `parametros`, `motivos`, RLS base, `dia_negocio()`.  
- **Aceptación:** login por los 3 roles; admin crea "Mesero 1" con PIN en \<10 segundos y lo desactiva.

### F1 — Núcleo operativo (MVP de servicio)

1. Mesas/zonas/VIP \+ cuentas \+ sub\_cuentas (estados completos, fiado incluido).  
2. App mesero: tomar pedido (búsqueda, cantidad, notas), envío Realtime; cola local offline con reintento (RNF-02).  
3. Centro de Mando: tablero de cuentas y pedidos en vivo; modificación/anulación con motivo obligatorio (RLS impide al mesero).  
4. Vista barra: comandas en vivo, marcar preparado/entregado (alimenta M-11).  
5. Pagos multimedios \+ propina sugerida 10% \+ cambio \+ división de cuentas \+ abonos a pendientes.  
- **Aceptación:** flujo completo mesa→pedido→barra→cobro dividido en \<2 s de latencia percibida; mesero no puede tocar un pedido enviado; toda anulación exige motivo y aparece en `log_auditoria`.

### F2 — Cierre de Caja

- Apertura con base obligatoria; retiros con observación; RPC `cerrar_caja` con conteo ciego, cruce faltante/sobrante, aprobación admin si ≠ 0, ticket de cierre (PDF), reseteo a cero.  
- Panel de caja C-01…C-06.  
- **Aceptación:** imposible operar sin base; imposible cerrar descuadrado sin credencial admin; tras cerrar, abrir exige nueva base; fiados sobreviven y sus abonos entran al ciclo en que se pagan.

### F3 — Catálogo, inventario y compras

- Productos (con presentación de compra \+ factor), historial de precios, categorías, combos configurables.  
- Kardex con triggers de stock; venta descuenta por unidad (combos descuentan componentes); alertas de stock bajo.  
- Compras: modo unidades o presentación (caja x24 → 24 unidades), actualización de costo.  
- Módulo **Auditoría de Inventario**: auditorías cortas con sugerencia de candidatos, conteo, diferencias, ajustes con motivo, reporte antihormigueo.  
- **Aceptación:** vender un combo descuenta cada componente; comprar 2 "cajas x24" suma 48 unidades; una auditoría con diferencia obliga a justificar con motivo y queda en kardex con usuario/hora.

### F4 — Facturación DIAN-ready

- Tablas `documentos`/`envios_comprobante`, clasificación automática 5 UVT (UVT parametrizable), captura de adquiriente cuando aplica, consecutivos, comprobante digital opcional por correo/WhatsApp, stubs `dian/` documentados \+ `docs/dian-integracion-futura.md` (checklist de habilitación: RUT, firma digital, set de pruebas, rangos).  
- **Aceptación:** una venta \> 5 UVT exige cédula/NIT y se clasifica como factura\_venta; el comprobante llega por correo al solicitarlo; ningún documento sale rotulado como fiscal.

### F5 — Métricas y reportes

- Módulo admin M-01…M-12 (vistas SQL materializadas donde convenga) \+ exportación CSV/Excel de todo.  
- **Aceptación:** margen por producto refleja el último costo de compra; días de stock y rotación coinciden con el kardex; tiempos de preparación se calculan de enviado→entregado.

### F6 — (Futuro, fuera de alcance actual) Integración DIAN

- Implementar `firmar/transmitir/validar` sobre la estructura ya existente; habilitación en ambiente DIAN; notas crédito/débito; contingencia. No iniciar sin instrucción explícita.

## 6\. Seed de desarrollo

Incluir en `seed.sql`: 1 admin, 1 caja, 3 meseros (PIN 1111/2222/3333); 8 mesas (2 VIP) \+ canal barra; categorías cervezas/licores/gaseosas-aguas/combos; \~15 productos con precios COP realistas (cerveza $8.000, aguardiente botella $120.000, etc.), 2 combos; 2 proveedores; parámetros: UVT 2026 \= $52.374 (ajustable), propina 10%, corte 06:00.

## 7\. Definición de "hecho" (por PR/tarea)

- Migración SQL versionada y reversible; RLS probada por rol (test que intenta la acción prohibida y falla).  
- UI en español, usable en celular gama media.  
- Acciones sensibles registradas en `log_auditoria`.  
- Sin lógica de dinero/stock exclusivamente en el cliente.  
- README de la fase actualizado con cómo probar el flujo.

8 Hosting VPS: el sistema debe prepararse para desplegarse en un VPS en Dokploy.

9\.  Sistema Control de Versiones y Repositorio: Git y GitHub

