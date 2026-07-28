# Mala Junta POS

Sistema POS y de gestión para Mala Junta, construido por fases con Supabase + Next.js App Router + TypeScript + Tailwind.

## Estado actual

Fase implementada: F0 - Fundaciones.

Incluye:
- Shell PWA de Next.js con rutas `/login`, `/mesero`, `/caja`, `/barra` y `/admin`.
- Login email/contraseña para `admin` y `caja`.
- Login de mesero con usuario + PIN de 4 dígitos.
- Migración Supabase con `perfiles`, `parametros`, `motivos`, `log_auditoria`, RLS base, RPC `crear_mesero` y `desactivar_usuario`, y función `dia_negocio()`.
- Seed local con 1 admin, 1 caja, 3 meseros, parámetros base y motivos iniciales.
- Pruebas pgTAP de RLS/RPC en `tests/rls/f0.sql`.

## Prerrequisitos

- Node.js 24+
- npm
- Docker Desktop o Podman en PATH para Supabase local

## Variables de entorno

Copia `.env.example` a `.env.local` y reemplaza los valores por los que entregue Supabase local:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_MESERO_AUTH_DOMAIN=mesero.malajunta.local
```

Con Supabase local corriendo puedes obtenerlos con:

```bash
npx supabase status
```

## Comandos

```bash
npm install
npx supabase start
npx supabase db reset
npm run test:sql:f0
npm run dev
```

Luego abre `http://localhost:3000/login`.

## Credenciales seed

- Admin: `admin@malajunta.local` / `Admin1234!`
- Caja: `caja@malajunta.local` / `Caja1234!`
- Mesero 1: usuario `mesero1` / PIN `1111`
- Mesero 2: usuario `mesero2` / PIN `2222`
- Mesero 3: usuario `mesero3` / PIN `3333`

## Criterios F0

- Login por los 3 roles: entrar con admin, caja y mesero desde `/login`.
- Admin crea un mesero: entrar como admin, usar el formulario de `/admin`, nombre + usuario + PIN.
- Admin desactiva mesero: desde la tabla de usuarios en `/admin`, pulsar `Desactivar`.
- RLS/RPC: correr `npm run test:sql:f0`; las pruebas intentan acciones prohibidas de mesero/caja y verifican que fallen.

## Nota de verificación local

En esta máquina no se pudo ejecutar Supabase local porque Docker/Podman no está disponible en PATH. `npm run typecheck`, `npm run lint` y `npm run build` sí pasan.

## Deudas conocidas F0

- `npm audit --omit=dev` reporta vulnerabilidad por `postcss@8.4.31` anidado dentro de Next `15.5.22`. npm sugiere bajar Next a `9.3.3`, lo cual rompería el stack moderno; queda pendiente actualizar Next cuando publique una rama estable con esa transitive corregida.
- Validar seed contra Supabase local cuando Docker esté instalado.