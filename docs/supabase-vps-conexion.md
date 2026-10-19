# Conexion Supabase VPS

Fecha: 2026-07-28

## Endpoint detectado

- HTTP Kong/API responde en `http://mala-junta-supabase-0add34-72-60-168-172.traefik.me`.
- HTTPS en el mismo dominio responde `404` desde Traefik, por lo que no parece estar enrutando al Kong/API correcto.

## Pruebas realizadas

- `/auth/v1/health` por HTTP: 200.
- `/rest/v1/` por HTTP: 200.
- `/auth/v1/health` por HTTPS: 404.
- `/rest/v1/` por HTTPS: 404.
- Puertos abiertos en el VPS: 80, 443, 5432, 6543.
- Postgres 5432 y Supavisor 6543 no aceptan SSL en la prueba inicial del protocolo PostgreSQL.

## Decision de seguridad

No se envio `service_role` ni password de Postgres por HTTP o Postgres sin SSL. Para aplicar migraciones hace falta una de estas opciones:

1. Corregir el router HTTPS de Dokploy/Traefik para que `https://.../auth/v1`, `/rest/v1`, `/storage/v1` apunten a Kong.
2. Habilitar SSL en Postgres/Supavisor y conectar con `sslmode=require`.
3. Dar acceso SSH temporal al VPS para ejecutar migraciones desde dentro de la red Docker.

## Estado local

`.env.local` queda configurado con URL HTTP y anon key para pruebas de salud, pero sin `SUPABASE_SERVICE_ROLE_KEY` activo hasta tener canal cifrado.

## Actualizacion: 19 de octubre de 2026

La configuracion actual usa `https://supabase-mala-junta.northbridge-finance.com`.
El servidor responde, pero el CORS de Kong no admite `Content-Profile`, enviado
por el SDK en las RPC POST. Esto bloquea `cuentas_activas_caja` y
`resumen_caja_actual` en el navegador. No se deben convertir estas consultas
a GET: la primera sincroniza la jornada y puede actualizar cuentas.

`lib/supabase-transport.ts` dirige las peticiones PostgREST del navegador al
mismo origen de la app, bajo `/api/supabase/rest/...`. La ruta Next.js contacta
exclusivamente el endpoint REST configurado con la clave publica y el mismo
Bearer del usuario. Conserva metodos, cuerpos, perfiles, filtros y respuestas
de PostgreSQL/RLS. No usa service role, cookies ni cache, no sigue redirecciones
y no reintenta escrituras. Auth, Storage y Realtime mantienen su conexion directa.

El cierre de caja muestra un error con boton para reintentar cuando no puede
cargar, en lugar de permanecer indefinidamente en `Cargando cierre de caja...`.

Validar el transporte, las operaciones de caja y la regresion de metricas:

```bash
npm run test:conexion
```

La ruta nueva requiere reconstruir y desplegar el contenedor de Next.js.
No requiere migraciones SQL ni credenciales nuevas.
