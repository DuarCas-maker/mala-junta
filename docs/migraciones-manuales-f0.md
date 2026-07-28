# Migraciones manuales F0

Daniel ejecuta estos archivos desde Supabase Studio > SQL Editor, en este orden.

## 1. Esquema, RLS y RPC

Archivo:

`supabase/manual/202607280001_f0_fundaciones_manual.sql`

Qué crea:

- Extensiones `pgcrypto` y `citext`.
- Enums `rol_usuario` y `tipo_motivo`.
- Tablas `perfiles`, `parametros`, `motivos`, `log_auditoria`.
- Funciones `perfil_actual_id()`, `rol_actual()`, `es_admin()`, `es_caja_o_admin()`, `dia_negocio()`, `crear_mesero()`, `desactivar_usuario()`.
- RLS base y grants.

Ejecutar una sola vez. Si falla por `already exists`, no lo vuelvas a correr completo: pásame el error exacto.

## 2. Seed de desarrollo

Archivo:

`supabase/manual/202607280002_f0_seed_manual.sql`

Qué crea:

- Usuarios Auth de prueba:
  - `admin@malajunta.local` / `Admin1234!`
  - `caja@malajunta.local` / `Caja1234!`
  - `mesero1` / `1111`
  - `mesero2` / `2222`
  - `mesero3` / `3333`
- Perfiles correspondientes.
- Parámetros base.
- Motivos iniciales.

Este seed es para entorno de desarrollo del proyecto Mala Junta. No borra datos existentes.

## 3. Verificaciones rápidas en SQL Editor

Después de ejecutar ambos, correr:

```sql
select rol, count(*)
from public.perfiles
group by rol
order by rol;

select public.dia_negocio('2026-07-28 04:00:00+00'::timestamptz) as dia_negocio_madrugada;

select clave, valor
from public.parametros
where clave in ('uvt_2026', 'propina_sugerida_pct', 'hora_corte_dia_negocio')
order by clave;
```

Resultado esperado:

- `admin = 1`, `caja = 1`, `mesero = 3`.
- `dia_negocio()` responde una fecha según corte 06:00 America/Bogota.
- Los parámetros base existen.

## 4. Probar desde la app

Cuando los SQL pasen:

1. Confirma que `.env.local` usa la URL pública correcta de Supabase.
2. Ejecuta:

```bash
npm run dev
```

3. Abre `http://localhost:3000/login`.
4. Prueba login con admin, caja y mesero.
5. Entra como admin y crea/desactiva un mesero nuevo.