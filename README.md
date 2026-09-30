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
npm ci                     # instala exactamente lo del package-lock.json
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

> `npm ci` en el Dockerfile usa el `package-lock.json` del repo: toda dependencia
> nueva se commitea junto con el lockfile actualizado.

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
  common/                 helpers transversales (errores de Postgres, transforms de DTOs)
  users/                  user_profiles (Fase 0: entidad + lectura; Fase 2: CRUD)
  mailboxes/              casillas, permisos por casilla, @RequireMailboxAccess (Fase 1)
  messages/               Fase 4 (módulo vacío)
  scheduled-messages/     Fase 5 (módulo vacío)
  templates/              Fase 6 (módulo vacío)
  drive-access/           Fase 7 (módulo vacío)
test/
  utils/jwt.ts            simula a Supabase Auth con claves ES256 propias
  utils/test-app.ts       app de prueba con la auth real y Supabase/DB simulados
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

Además, todo lo que opera sobre el **contenido** de una casilla (mensajes, programados,
plantillas, Drive) usa `@RequireMailboxAccess('read' | 'send')`, que lee `:mailboxId`
de la ruta y exige ese permiso en `mailbox_access`. **Ser admin no da acceso
implícito**: el admin gestiona casillas y permisos, pero para leer o enviar necesita
tener el permiso asignado como cualquier usuario.

Códigos de respuesta:

| Caso | Código |
|---|---|
| Sin token, token mal formado, vencido o mal firmado | 401 |
| Token válido pero sin perfil, desactivado o sin el rol pedido | 403 |
| Sin el permiso pedido sobre la casilla (o la casilla no existe) | 403 |
| No se pudo obtener el JWKS de Supabase (caído / timeout) | 503 |

### Endpoints

| Método y ruta | Quién | Fase | Descripción |
|---|---|---|---|
| `GET /health` | público | 0 | Healthcheck (API + DB) |
| `GET /me` | logueado | 0 | `{ id, email, role }` del usuario actual |
| `GET /mailboxes` | admin | 1 | `AdminMailbox[]` |
| `POST /mailboxes` | admin | 1 | Alta `{ email, displayName }` → `AdminMailbox` (409 si el email existe) |
| `PATCH /mailboxes/:id` | admin | 1 | `{ displayName }` → `AdminMailbox` |
| `DELETE /mailboxes/:id` | admin | 1 | Desconecta (borra casilla y accesos) → 204 |
| `POST /mailboxes/:id/reconnect` | admin | 1 | **501** hasta la Fase 3 (OAuth de Google) |
| `GET /me/mailboxes` | logueado | 1 | `Mailbox[]` a las que el usuario tiene algún permiso |

Los tipos de respuesta son los mismos que usa el frontend (`lib/types/*.ts`).

---

## Puesta en producción (checklist)

Tareas de configuración (no de código) antes de presentarlo a Corebio:

- [ ] **SMTP propio en Supabase** (Authentication → Emails → SMTP Settings).
  - El SMTP incluido en Supabase solo envía a miembros del equipo del proyecto y con
    un límite muy bajo por hora: no sirve para invitar a otras personas.
  - Para pruebas (Fase 2): Brevo con un remitente verificado (un Gmail propio), sin DNS.
  - Para Corebio: remitente `@corebio.org` con SPF/DKIM en el DNS de `corebio.org`
    (lo configura la gente de IT de Corebio).
- [ ] **Redirect URLs** (Authentication → URL Configuration): incluir
  `http://localhost:3000/reset-password` y
  `https://corebio-email-collection.vercel.app/reset-password`.
- [ ] **Plantillas de email** (Authentication → Emails → Templates), para que los links
  funcionen con el flujo PKCE del frontend y desde cualquier dispositivo:
  - Invite user: `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite`
  - Reset password: `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery`
  - Requiere el cambio del frontend en `/reset-password` (rama
    `fix/invite-link-token-hash` del repo del front).
- [ ] **Deploy en Railway** (ver arriba) y agregar la URL del backend al frontend.

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
  - `app_metadata.role` se va a seguir actualizando (Fase 2), pero solo para que el
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
  aceptaron la invitación. El pasaje `invited → active` se resuelve en la Fase 2 (Users).
- **Puerto local 4000**, para no chocar con `next dev` (3000).
- **Node 24 LTS** en Docker. Node 20 (propuesto al principio) llegó a fin de vida en
  abril de 2026.
- **`.gitattributes` con `* text=auto eol=lf`**: todo el repo usa saltos de línea LF,
  también en Windows. Sin esto, Prettier marcaba cada línea con `Delete ␍`.
- **`tsBuildInfoFile` dentro de `dist/`** (en `tsconfig.build.json`): `nest build` borra
  `dist/` antes de compilar. Si la caché incremental de tsc queda afuera, tsc cree que no
  hay cambios y el segundo build termina sin generar nada. Así la caché se borra junto
  con `dist/`.

**Verificación**
- El código se generó en un entorno sin acceso al registry de npm. Build, lint y tests
  los corre el equipo en local, en cada fase.
- ✅ Verificado en local: `build`, `lint`, `test` y `test:e2e` pasan.
- ✅ Verificado contra Supabase: la migración `CreateUserProfiles` está aplicada y
  `GET /health` y `GET /me` responden bien con un token real (200 con token; 401 sin
  token o con token inválido).
- ⏳ Falta: el primer deploy en Railway (conexión IPv6 vs. Session pooler).

### ✅ Fase 1 — Mailboxes (sin Google)

**Qué se construyó**
- Migración `CreateMailboxes`: tablas `mailboxes` y `mailbox_access`, con el mismo
  cerrojo de RLS que `user_profiles`.
- Endpoints de admin: `GET/POST /mailboxes`, `PATCH/DELETE /mailboxes/:id`,
  `POST /mailboxes/:id/reconnect` (501 hasta la Fase 3).
- `GET /me/mailboxes` para cualquier usuario logueado.
- `MailboxAccessService` (exportado): permisos de un usuario sobre una casilla,
  `mailboxAccess` por usuario y reemplazo completo del campo `access` del frontend.
  Lo usa Users en la Fase 2.
- `@RequireMailboxAccess('read' | 'send')` + `MailboxAccessGuard`: la barrera de
  seguridad de Messages, Scheduled, Templates y Drive.
- `configureApp()` (`src/app.setup.ts`): la misma `ValidationPipe` para producción y tests.
- Tests unitarios (servicios, guard, errores de Postgres) y e2e (endpoints + guard).

**Decisiones**
- **Orden de fases cambiado: Mailboxes antes que Users.** `mailbox_access` une usuarios
  (que ya existen desde la Fase 0) con casillas (que no existían). Construyendo primero
  lo que faltaba, cada módulo se cierra una sola vez. El OAuth de Google pasa a ser su
  propia fase (3), para no mezclar la pieza más delicada con un CRUD.
- **Email de la casilla en minúsculas y único**, garantizado por la base (CHECK +
  UNIQUE), no solo por el DTO. Un email repetido responde 409 aunque dos requests
  lleguen a la vez.
- **`authType` y `status` desde ahora.** `authType` (`oauth` | `domain_wide`) permite
  sumar domain-wide delegation más adelante sin migrar el esquema. `status` arranca en
  `needs_reconnect` hasta que exista el OAuth (Fase 3). Las columnas del token de Google
  se agregan en la Fase 3.
- **`mailbox_access` solo guarda filas con algún permiso** (CHECK `can_send OR can_read`):
  "sin acceso" = no hay fila. Guardar permisos reemplaza el set completo del usuario en
  una transacción, igual que manda el frontend (`access: Record<mailboxId, ...>`).
- **`connectedUsersCount` cuenta a todos los usuarios con acceso**, incluidos los
  desactivados: mismo criterio que los mocks del frontend y que la lista "Ver usuarios
  con acceso".
- **Ser admin no da acceso al contenido de las casillas** (ver Autenticación).
- **Casilla inexistente o sin permiso → 403 en ambos casos** en `@RequireMailboxAccess`,
  para no revelar qué ids existen.
- **`GET /mailboxes/:id/access` se movió a la Fase 2.** Según el frontend
  (`getMailboxAccessList`) devuelve `{ user: AdminUser, access: MailboxAccessSummary }[]`,
  o sea datos completos de usuario: corresponde al módulo de Users.
- **No se restringe el dominio de las casillas a `@corebio.org`**: en desarrollo se usan
  cuentas de Gmail propias.

**Verificación**
- Igual que la Fase 0: build, lint y tests los corre el equipo en local.
- A verificar contra Supabase: `npm run migration:run` (crea `mailboxes` y
  `mailbox_access`) y los endpoints con un token de admin real.

### ⏳ Pendiente

- **Fase 2 — Users:**
  - CRUD de admin + `GET /mailboxes/:id/access`.
  - Invitación vía Supabase Admin API (requiere `SUPABASE_SERVICE_ROLE_KEY`), con
    `redirectTo` a `<FRONTEND_URL>/reset-password`.
  - Sincronizar `app_metadata.role`; transición `invited → active`; ban en Supabase al
    desactivar; reglas de "no quedarse sin admins".
  - Antes de probar invitaciones: SMTP de pruebas (ver checklist).
- **Fase 3 — Google:**
  - OAuth por casilla, con `refresh_token` encriptado (AES-256-GCM).
  - Interfaz `GoogleMailboxClient.forMailbox(mailboxId)`, que elige la implementación
    según `authType`.
  - `POST /mailboxes/:id/reconnect` real y revocar el token al desconectar.
- **Fase 4 — Messages/Sent** (Gmail API).
- **Fase 5 — Scheduled messages** (tabla + job periódico).
- **Fase 6 — Templates.**
- **Fase 7 — Drive access** (Drive API).
