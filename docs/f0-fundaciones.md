# F0 - Fundaciones

## Qué se construyó

- Base Next.js App Router + TypeScript + Tailwind como PWA inicial.
- Rutas por rol: `/mesero`, `/caja`, `/barra`, `/admin`.
- Login de admin/caja por email y contraseña.
- Login de mesero por usuario + PIN, usando un correo interno `usuario@mesero.malajunta.local` para mantener sesión real de Supabase Auth.
- Tablas fundacionales: `perfiles`, `parametros`, `motivos`, `log_auditoria`.
- Funciones SQL: `dia_negocio()`, `rol_actual()`, `perfil_actual_id()`, `crear_mesero()`, `desactivar_usuario()`.
- RLS base por rol y pruebas pgTAP.

## Cómo probar

1. Instalar Docker Desktop o Podman y confirmar que `docker --version` funciona.
2. Ejecutar:

```bash
npm install
npx supabase start
npx supabase db reset
npm run test:sql:f0
npm run dev
```

3. Abrir `http://localhost:3000/login`.
4. Probar credenciales seed:
   - Admin: `admin@malajunta.local` / `Admin1234!`
   - Caja: `caja@malajunta.local` / `Caja1234!`
   - Mesero: `mesero1` / `1111`
5. Entrar como admin y crear un mesero nuevo con PIN de 4 dígitos.
6. Desactivar ese mesero desde la tabla de usuarios.

## Criterios de aceptación

| Criterio | Estado | Verificación |
| --- | --- | --- |
| Login por admin/caja/mesero | Pendiente de prueba local con Supabase | UI y seed implementados; falta Docker para correr Supabase local. |
| Admin crea Mesero 1 con PIN en menos de 10 s | Pendiente de prueba local con Supabase | Ruta API + RPC implementadas. |
| Admin desactiva mesero | Pendiente de prueba local con Supabase | Ruta API + RPC implementadas; registra auditoría. |
| RLS bloquea acciones prohibidas | Pendiente de ejecución | Test `tests/rls/f0.sql` creado; requiere Supabase local corriendo. |
| Build frontend | Listo | `npm run build` pasa. |
| Typecheck/lint | Listo | `npm run typecheck` y `npm run lint` pasan. |

## Bloqueo encontrado

Supabase local no pudo arrancar porque Docker/Podman no está en PATH. Instalar Docker Desktop y repetir la sección de prueba.