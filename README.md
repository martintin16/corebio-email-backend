# Corebio Mail — Backend

API de **Corebio Mail**: permite que cada persona de Corebio use las casillas
institucionales de Gmail (ej. `tesoreria@corebio.org`) y su Drive con permisos
propios (`canSend` / `canRead`), sin compartir la contraseña de la casilla.

- Frontend (ya en producción): [`corebio-email-collection`](https://github.com/martintin16/corebio-email-collection) → https://corebio-email-collection.vercel.app
- Stack: **NestJS 11 + TypeScript + TypeORM**, Postgres del proyecto de **Supabase**
  (el mismo que se usa para Auth), deploy en **Railway**.

---

## Correr en local

Requisitos: Node 24 LTS (mínimo 22.12; ver `.nvmrc`) y npm.

```bash
npm install                # la primera vez genera package-lock.json → commitearlo
cp .env.example .env       # completar DATABASE_URL con la contraseña real
npm run migration:run      # crea las tablas en Supabase (una vez por migración nueva)
npm run start:dev          # http://localhost:4000
```

Probar que anda:

```bash
curl http://localhost:4000/health                     # {"status":"ok",...}
curl http://localhost:4000/me                         # 401 (sin token)
curl -H "Authorization: Bearer <ACCESS_TOKEN>" http://localhost:4000/me
# → {"id":"...","email":"...","role":"admin"}
```

Un access token real se puede sacar del frontend logueado (DevTools → Application →
Local Storage / cookies de Supabase → `access_token`).

### Scripts

| Script | Qué hace |
|---|---|
| `npm run start:dev` | Levanta la API con recarga automática |
| `npm run build` | Compila a `dist/` |
| `npm run typecheck` | Chequea tipos de todo el proyecto (incluye tests) |
| `npm run lint` | ESLint + Prettier |
| `npm test` | Tests unitarios (`src/**/*.spec.ts`) |
| `npm run test:e2e` | Tests de punta a punta sobre HTTP (`test/*.e2e-spec.ts`) |
| `npm run test:cov` | Unitarios con cobertura |
| `npm run migration:run` / `:revert` / `:show` | Migraciones contra la DB del `.env` |

**Checklist antes de cada commit:** `npm run build && npm run lint && npm test && npm run test:e2e`.

### Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `DATABASE_URL` | Sí | Connection string de Supabase (Project Settings → Database). |
| `DATABASE_SSL` | No (`true`) | SSL hacia Postgres. Solo apagar para un Postgres local. |
| `DATABASE_SSL_CA` | No | Certificado CA de Supabase (PEM). Si está, se valida el certificado del servidor. |
| `SUPABASE_URL` | Sí | `https://etwiwzuwwnzijdxjbfqx.supabase.co` |
| `SUPABASE_JWT_AUDIENCE` | No (`authenticated`) | Audience esperada en los JWT. |
| `CORS_ORIGINS` | Sí | Orígenes permitidos separados por coma. |
| `PORT` | No (`4000`) | Railway lo inyecta solo. |
| `NODE_ENV` | No | `development` / `production` / `test`. |

Si falta una obligatoria o tiene un formato inválido, la app **no arranca** y dice cuál.

---

## Deploy en Railway

1. Nuevo servicio desde el repo de GitHub. Railway toma `railway.json` + `Dockerfile`.
2. Cargar las variables de entorno de la tabla de arriba (no `PORT`).
3. En cada deploy, Railway:
   - corre las migraciones pendientes (`preDeployCommand` → `npm run migration:run:prod`);
   - espera a que `GET /health` responda 200 antes de pasar tráfico.

> `npm ci` en el Dockerfile necesita `package-lock.json` commiteado.

**Conexión directa vs. IPv6:** la connection string directa de Supabase
(`db.<ref>.supabase.co`) es solo IPv6. Si el deploy falla con errores de conexión
(`ENETUNREACH`, `ENOTFOUND`, timeout), cambiar `DATABASE_URL` por la del **Session
pooler** (Supabase → Connect → Session pooler, puerto **5432**). Se comporta como
una conexión persistente; no usar el *Transaction* pooler (6543). No hace falta
tocar código.

---

## Arquitectura

Organizado **por entidad**: cada carpeta es un módulo de Nest autocontenido
(`controller` + `service` + `dto/` + `entities/` + `module`).

```
src/
  main.ts                 bootstrap: helmet, CORS, ValidationPipe global
  app.module.ts           config + TypeORM + módulos
  config/                 validación de env (Joi), parseo de CORS
  database/               opciones de TypeORM, DataSource del CLI, migrations/
  auth/                   JWT de Supabase, guards globales, decorators, GET /me
  health/                 GET /health (Railway)
  users/                  user_profiles (Fase 0: entidad + lectura; Fase 1: CRUD)
  mailboxes/              Fase 2 (módulo vacío)
  messages/               Fase 3 (módulo vacío)
  scheduled-messages/     Fase 4 (módulo vacío)
  templates/              Fase 5 (módulo vacío)
  drive-access/           Fase 6 (módulo vacío)
test/
  utils/jwt.ts            simula a Supabase Auth con claves ES256 propias
  *.e2e-spec.ts           tests HTTP de punta a punta
```

### Autenticación y autorización

Todo endpoint requiere token **por defecto**. Hay dos guards globales, en este orden:

1. **`JwtAuthGuard`**
   - Lee `Authorization: Bearer <token>`.
   - Verifica el JWT de Supabase con **ES256 contra el JWKS público**
     (`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`), validando issuer, audience y
     expiración. El backend no guarda ningún secreto para esto, y la key legacy
     HS256 no se acepta.
   - Carga el perfil del usuario desde `user_profiles`. Sin perfil o con
     `status = inactive` → **403**.
   - Deja `request.user = { id, email, role }`.
2. **`RolesGuard`**: si el endpoint tiene `@Roles('admin')`, exige ese rol.

Decorators: `@Public()` (sin token), `@Roles(...)`, `@CurrentUser()`.

Códigos de respuesta:

| Caso | Código |
|---|---|
| Sin token, token mal formado, vencido o mal firmado | 401 |
| Token válido pero sin perfil, desactivado o sin el rol pedido | 403 |
| No se pudo obtener el JWKS de Supabase (caído / timeout) | 503 |

---

## Fases

### ✅ Fase 0 — Estructura del proyecto

**Qué se construyó**
- Scaffolding de NestJS 11 + TypeORM + validación de entorno (Joi).
- Conexión a Postgres de Supabase con SSL, `synchronize: false` y migraciones versionadas.
- Auth: guard global de JWT (ES256/JWKS), `RolesGuard`, decorators, `GET /me`.
- Tabla `user_profiles` (migración `CreateUserProfiles`).
- `GET /health` con ping a la DB.
- Módulos vacíos por entidad, registrados en `AppModule`.
- Dockerfile multi-stage + `railway.json` (migraciones pre-deploy + healthcheck).
- Tests unitarios (verificador JWT, guards, CORS, env, opciones de DB) y e2e (auth, health).

**Decisiones**

- **El rol y el estado salen de la DB (`user_profiles`), no del claim del JWT.**
  - Desactivar a alguien o cambiarle el rol tiene efecto en el próximo request, sin
    esperar a que venza su token (hasta 1 h).
  - El costo es una query por PK por request, despreciable a esta escala.
  - `app_metadata.role` se va a seguir actualizando (Fase 1), pero solo para que el
    frontend oculte UI.
- **`user_profiles` en vez de `users`.**
  - Evita confundirse con `auth.users`.
  - `id` = `auth.users.id` (FK, `ON DELETE CASCADE`).
  - El email no se duplica: se lee de `auth.users` y del JWT.
- **Trigger `on_auth_user_created` sobre `auth.users`.** Todo usuario nuevo de
  Supabase Auth recibe un perfil automáticamente, aunque se cree desde el dashboard.
  Con eso no hay usuarios "huérfanos".
- **Backfill en la migración.** Los usuarios existentes reciben su perfil con el rol de
  `app_metadata.role`, así el admin actual sigue siéndolo sin tocar nada a mano.
- **RLS habilitado sin políticas + `REVOKE` a `anon`/`authenticated`.**
  - Esto **no** es autorización por RLS: esa sigue fuera de alcance y vive en los guards.
  - Es un cerrojo: sin esto, cualquier tabla de `public` queda expuesta a la Data API
    de Supabase usando la anon key, que es pública porque está en el frontend.
  - El backend se conecta como `postgres` (dueño de la tabla), que no está sujeto a RLS.
  - **Toda tabla nueva en fases siguientes lleva lo mismo.**
- **Usuarios `invited` pueden autenticarse.** Tener sesión válida implica que ya
  aceptaron la invitación. El pasaje `invited → active` se resuelve en la Fase 1.
- **Puerto local 4000**, para no chocar con `next dev` (3000).
- **Node 24 LTS** en Docker. Node 20 (propuesto al principio) llegó a fin de vida en
  abril de 2026.

**Verificación**
- ⚠️ **No se compiló ni se corrieron los tests en el entorno donde se generó el código**:
  ese entorno no tiene acceso al registry de npm. La verificación de build, lint y
  tests la hace el equipo en local, en cada fase.
- A verificar manualmente:
  - Que la migración corra contra Supabase (en particular, el trigger sobre `auth.users`).
  - `GET /health` y `GET /me` con un token real.
  - El deploy en Railway (conexión IPv6 vs. Session pooler).

### ⏳ Pendiente

- **Fase 1 — Users:**
  - CRUD de admin.
  - Invitación vía Supabase Admin API (requiere `SUPABASE_SERVICE_ROLE_KEY`).
  - Sincronizar `app_metadata.role`.
  - Transición `invited → active`.
- **Fase 2 — Mailboxes:**
  - CRUD y `mailbox_access`.
  - OAuth de Google por casilla, con `refresh_token` encriptado (AES-256-GCM) y campo
    `authType: 'oauth' | 'domain_wide'`.
  - Interfaz `GoogleMailboxClient.forMailbox(mailboxId)`.
- **Fase 3 — Messages/Sent** (Gmail API).
- **Fase 4 — Scheduled messages** (tabla + job periódico).
- **Fase 5 — Templates.**
- **Fase 6 — Drive access** (Drive API).
