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
cp .env.example .env       # completar DATABASE_URL (ver abajo)
npm run migration:run      # crea las tablas en Supabase (una vez por migración nueva)
npm run start:dev          # http://localhost:4000
```

**`DATABASE_URL`: usar el Session pooler.** En Supabase → botón **Connect** → Type
**URI** → Method **Session pooler** → copiar la URI y poner la contraseña real
(`postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`).

- La conexión directa (`db.<ref>.supabase.co`) **solo tiene IPv6**. En redes sin IPv6
  (la mayoría de las conexiones hogareñas, y puede variar de un día para otro según el
  proveedor o el router) falla con `ENOTFOUND` / `ENETUNREACH`, aunque Supabase esté bien.
- El Session pooler funciona por IPv4 y se comporta como una conexión persistente.
  **No** usar el *Transaction* pooler (puerto 6543).
- Si la contraseña tiene caracteres especiales (`@ # / % :`), van codificados en la URI
  (ej. `@` → `%40`).

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
| `SUPABASE_SERVICE_ROLE_KEY` | Sí | Secret key (`sb_secret_...`) o la legacy `service_role` (Project Settings → API Keys). Invita, banea y borra usuarios. **Solo en el backend.** |
| `FRONTEND_URL` | Sí | Base del front. Los links de invitación vuelven a `<FRONTEND_URL>/reset-password`; el callback de Google redirige a `<FRONTEND_URL>/admin/mailboxes`. |
| `GOOGLE_CLIENT_ID` | Sí | OAuth Client (Web application) de Google Cloud. |
| `GOOGLE_CLIENT_SECRET` | Sí | Secret de ese client. |
| `GOOGLE_OAUTH_REDIRECT_URI` | Sí | `http://localhost:4000/mailboxes/oauth/callback` en local. Idéntica a la registrada en el client. |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Sí | 32 bytes en base64. Encripta los refresh_token. **Si cambia, hay que reconectar todas las casillas.** |
| `OAUTH_STATE_SECRET` | Sí | Mínimo 32 caracteres. Firma el `state` del flujo OAuth. |
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

**Base de datos en Railway:** usar la misma URI del **Session pooler** que en local
(ver "Correr en local"), así el deploy no depende de que Railway tenga salida IPv6.

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
  google/                 OAuth con Google, encriptación de tokens, GoogleMailboxClient (Fase 3)
  users/                  user_profiles, gestión de usuarios e invitaciones (Fases 0 y 2)
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
     `status = inactive` → **403**. Si está `invited`, pasa a `active` (primer
     request después de aceptar la invitación).
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
| `DELETE /mailboxes/:id` | admin | 1·3 | Desconecta: revoca el permiso en Google y borra casilla y accesos → 204 |
| `POST /mailboxes/:id/reconnect` | admin | 3 | Primera conexión o reconexión con Google → `{ authUrl }` (llevar el navegador ahí) |
| `GET /mailboxes/oauth/callback` | público | 3 | Vuelta de Google. Redirige a `<FRONTEND_URL>/admin/mailboxes?connected=<id>` o `?connectionError=<code>` |
| `GET /me/mailboxes` | logueado | 1 | `Mailbox[]` a las que el usuario tiene algún permiso |
| `GET /users` | admin | 2 | `AdminUser[]` |
| `POST /users` | admin | 2 | `{ name, email, role, access }` → invita y devuelve `AdminUser` (201; 409 si el email existe) |
| `PATCH /users/:id/permissions` | admin | 2 | `{ role, access }` (reemplaza todos los permisos) → `AdminUser` |
| `PATCH /users/:id/deactivate` | admin | 2 | Desactiva y banea en Supabase Auth → `AdminUser` |
| `DELETE /users/:id` | admin | 2 | Borra de Supabase Auth (perfil y permisos en cascada) → 204 |
| `POST /users/:id/resend-invite` | admin | 2 | Reenvía la invitación (solo `invited`; si no, 409) → 204 |
| `GET /mailboxes/:id/access` | admin | 2 | `{ user: AdminUser, access }[]` de esa casilla |

Los tipos de respuesta son los mismos que usa el frontend (`lib/types/*.ts`).

---

## Puesta en producción (checklist)

Tareas de configuración (no de código) antes de presentarlo a Corebio:

- [x] **SMTP propio en Supabase** (Authentication → Emails → SMTP Settings) — para
  pruebas, configurado con un Gmail personal.
  - El SMTP incluido en Supabase solo envía a miembros del equipo del proyecto y con
    un límite muy bajo por hora: no sirve para invitar a otras personas.
  - [ ] Para Corebio: remitente `@corebio.org` con SPF/DKIM en el DNS de `corebio.org`
    (lo configura la gente de IT de Corebio).
- [x] **URL Configuration** (Authentication → URL Configuration):
  - Site URL: `https://corebio-email-collection.vercel.app` (sin barra final).
  - Redirect URLs: `http://localhost:3000/reset-password` y
    `https://corebio-email-collection.vercel.app/reset-password`.
- [x] **Plantillas de email** (Authentication → Emails → Templates). El link de cada una:
  - Invite user: `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite`
  - Reset password: `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery`
  - Con `token_hash` el link funciona con el flujo PKCE del frontend y desde cualquier
    dispositivo (lo valida `/reset-password` con `verifyOtp`). Verificado: invitación y
    "olvidé mi contraseña" de punta a punta.
  - **Las invitaciones se mandan desde la app, no desde el dashboard de Supabase**: el
    dashboard no indica destino, `{{ .RedirectTo }}` cae en la Site URL y el link llega
    sin `/reset-password`. El backend siempre manda `<FRONTEND_URL>/reset-password`.
- [ ] **Google para producción** (lo configura Corebio en su Google Workspace):
  - Proyecto de Google Cloud dentro de la organización de Corebio, con la pantalla de
    consentimiento en **Internal**: no requiere verificación de Google y los
    refresh_token no vencen. (En el proyecto de desarrollo, en modo *Testing*, vencen a
    los 7 días y la casilla pasa a "reconectar".)
  - Redirect URI de producción: `https://<backend>/mailboxes/oauth/callback`.
  - Actualizar `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `GOOGLE_OAUTH_REDIRECT_URI`
    y reconectar cada casilla una vez (los tokens son de cada client).
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
- ⏳ Falta: el primer deploy en Railway.

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
- ✅ En local: `build`, `test` y `test:e2e` pasan. `lint` marcó un
  `no-unsafe-return` en el `@Transform` del email de `CreateMailboxDto`, corregido
  moviéndolo a `trimLowerString` (`src/common/transforms.ts`).
- ✅ Contra Supabase, con token de admin real: migración `CreateMailboxes` aplicada;
  crear, listar, editar y borrar casillas; email normalizado (minúsculas, sin
  espacios); 409 con email duplicado; 400 en validaciones (campo de más, id que no es
  UUID); 404; 501 en reconnect; `GET /me/mailboxes` devuelve `[]` para un admin sin
  accesos asignados.

### ✅ Fase 2 — Users

**Qué se construyó**
- Endpoints de admin: `GET/POST /users`, `PATCH /users/:id/permissions`,
  `PATCH /users/:id/deactivate`, `DELETE /users/:id`, `POST /users/:id/resend-invite` y
  `GET /mailboxes/:id/access`, con los tipos exactos del frontend (`AdminUser`,
  `{ user, access }[]`).
- `SupabaseAdminClient`: interfaz propia sobre la Admin API de Supabase (invitar,
  reenviar, sincronizar rol, banear, borrar). La implementación usa `@supabase/supabase-js`
  con la secret key; los tests usan un doble.
- Validador `@IsMailboxAccessRecord()` para el campo `access`
  (`Record<uuid, { canSend: boolean, canRead: boolean }>`, sin campos de más).
- Migración `ActivateProfileOnInviteAccepted`: trigger sobre `auth.users` que pasa el
  perfil de `invited` a `active` cuando la persona acepta la invitación, más backfill.
- `JwtAuthGuard`: además, un usuario `invited` pasa a `active` en su primer request
  (red de seguridad).
- `MailboxAccessService.validateInput()` y `MailboxesService` exportado (Fase 1).
- Variables nuevas: `SUPABASE_SERVICE_ROLE_KEY` y `FRONTEND_URL`.
- Tests unitarios (servicio, cliente de Supabase, validador, DTOs, guard) y e2e.

**Decisiones**
- **Alta en orden "validar → invitar → guardar".** Antes de mandar el email se valida el
  `access` (ids y casillas existentes) y que el email no tenga cuenta en `auth.users`
  (409). Después: invitación (Supabase crea el usuario y el trigger de la Fase 0 el
  perfil), y en una transacción nombre/rol/estado + permisos, y por último
  `app_metadata.role`. Si algo de eso falla, se borra el usuario de Auth: no quedan
  cuentas a medias (el email ya enviado queda con un link que no sirve).
- **`app_metadata.role` es solo una ayuda para la UI.** La autorización lee
  `user_profiles`. Al editar permisos, si sincronizar `app_metadata` falla se loguea y
  el pedido no falla. En el alta sí se deshace, para no arrancar desincronizado.
- **Un admin no puede quitarse el rol, desactivarse ni borrarse a sí mismo.** Como quien
  hace el pedido es siempre un admin activo, esa sola regla garantiza que nunca se quede
  el sistema sin administradores (no hace falta contar admins ni bloquear filas).
- **Desactivar = `status = inactive` + ban en Supabase Auth.** El guard lo bloquea en
  el próximo request; el ban impide además loguearse y renovar el token. Si el ban
  falla responde 502 y se puede reintentar (es idempotente).
- **`invited → active` lo decide la base, no el frontend.** Aceptar la invitación
  (validar el link) hace que Supabase complete `email_confirmed_at` y `last_sign_in_at`
  en `auth.users`; un trigger lo detecta y activa el perfil en ese momento. La primera
  versión lo hacía solo en el guard, al primer request al backend: en la verificación
  el usuario quedó `invited` porque `/reset-password` no llama al backend (y en general
  alguien puede aceptar y no volver a entrar en días). El trigger solo toca perfiles
  `invited`: un usuario desactivado no se reactiva por iniciar sesión.
- **Reenviar invitación solo si está `invited`** (si no, 409). Si Supabase no permite
  reenviar la invitación, se manda el email de "elegir contraseña" (plantilla Reset
  password), que lleva a la misma pantalla.
- **Errores de Supabase Auth → 502** con un mensaje genérico; el detalle va al log.
- **No se exige un mínimo de casillas por usuario** (el frontend deja la decisión al
  backend; un admin puede no tener ninguna).
- **Sin endpoint para reactivar usuarios**: el frontend no tiene esa acción. Pendiente
  de producto.

**Verificación**
- ✅ Dependencia `@supabase/supabase-js` instalada y `package-lock.json` commiteado.
- ✅ En local: `build`, `test` (130) y `test:e2e` (62) pasan. `lint` marcó un cast
  innecesario en `users.service.spec.ts`, corregido.
- ✅ Contra Supabase: alta con invitación (201), 409 por email duplicado y por
  autoedición/autodesactivación, 400 con `access` inválido, `GET /mailboxes/:id/access`,
  `resend-invite` (llega el mail con el link a `/reset-password`), edición de permisos,
  desactivar bloquea el login, borrar → 204.
- ✅ Corregido y verificado: en la primera prueba el usuario seguía `invited` después de
  aceptar la invitación (ver decisión del trigger). Con `65634e6` y la migración
  `ActivateProfileOnInviteAccepted` aplicada: invitar → aceptar en incógnito desde el
  front, sin ningún request al backend con ese usuario → `GET /users` lo muestra
  `active`. Un usuario desactivado no puede loguearse y sigue `inactive`.
- ⏳ El backfill de la migración no se probó (no quedaban usuarios aceptados en
  `invited`); es un `UPDATE` simple con la misma condición que el trigger.

### ✅ Fase 3 — Conexión de casillas con Google (OAuth)

**Qué se construyó**
- Módulo `google/` (infraestructura, como `auth/`):
  - `GoogleMailboxClient.forMailbox(mailboxId)` → `{ gmail, drive, email }` autenticados
    como la casilla. Es lo único que van a usar las Fases 4–7. Elige la estrategia según
    `authType`: `oauth` (refresh_token de la casilla) o `domain_wide` (placeholder → 501).
  - `TokenCipher`: AES-256-GCM para los refresh_token.
  - `OAuthStateService`: `state` firmado (JWT HS256, 10 min, casilla + admin).
  - `GoogleOAuthClient`: interfaz propia sobre `googleapis` (URL de consentimiento,
    canje del code, email de la cuenta, revocar).
- `MailboxConnectionService`: flujo completo (inicio, callback, desconexión con revocación).
- `POST /mailboxes/:id/reconnect` → `{ authUrl }` y `GET /mailboxes/oauth/callback`.
- Migración `AddMailboxGoogleCredentials`: `google_refresh_token` (encriptado),
  `google_scopes`, `connected_at`, `connected_by`.
- Tests unitarios (cifrado, state, comparación de emails, cliente por casilla, flujo de
  conexión) y e2e (reconnect, callback público, desconexión).

**Decisiones**
- **El refresh_token se encripta en la aplicación**, no en la base: un dump o un acceso
  indebido a la tabla no alcanza para usar las casillas. La columna tiene `select: false`
  para que nunca salga en una consulta, una respuesta o un log por accidente.
- **Se verifica que la cuenta conectada sea la casilla** (email de Gmail = email de la
  casilla). Si no, `tesoreria@` quedaría leyendo el correo de otra persona. En Gmail se
  ignoran los puntos y `googlemail.com`.
- **Se verifican los permisos otorgados**: la pantalla de Google deja destildarlos; sin
  `gmail.modify` y `drive` la conexión se rechaza. En cualquier rechazo posterior al
  canje se revoca el permiso recién otorgado.
- **`access_type=offline` + `prompt=consent`**: Google devuelve siempre un refresh_token,
  también al reconectar.
- **El callback siempre redirige al frontend** (`?connected=` o `?connectionError=<code>`),
  nunca muestra una pantalla de error del backend. Cuando el `state` es válido (también
  si la persona canceló en Google) se agrega `&mailboxId=<id>`; si no se puede verificar,
  no se incluye.
- **Un cliente OAuth2 por casilla, cacheado en memoria**: el access_token (~1 h) se renueva
  solo al vencer, no en cada pedido. Railway corre una sola instancia; con varias, cada
  una tendría su caché (sin problema de consistencia, solo más renovaciones).
- **Si Google rechaza el token (`invalid_grant`) o no se puede desencriptar**, la casilla
  pasa sola a `needs_reconnect` y se responde 409 `mailbox_needs_reconnect`.
- **Desconectar revoca el permiso en Google** antes de borrar; si Google no responde,
  igual se borra.
- **No se revoca el token anterior al reconectar**: revocar un refresh_token revoca el
  permiso completo de esa cuenta y dejaría sin efecto el recién obtenido.
- **`reconnect` sirve para la primera conexión y para reconectar.**

**Cambio de contrato con el frontend (pendiente de la mini-fase front↔back)**
- `reconnectMailbox` hoy espera `{ ok }`; con OAuth recibe `{ authUrl }` y tiene que
  llevar el navegador ahí. `connectMailbox` = `POST /mailboxes` + ese mismo paso.
- `/admin/mailboxes` puede leer `?connected=<id>` / `?connectionError=<code>&mailboxId=<id>`
  para mostrar un aviso.
- Si el admin vuelve de Google sin sesión en ese navegador, el middleware lo manda a
  `/login` y se pierde la vuelta a `/admin/mailboxes`. Conviene que el login recuerde la
  ruta de destino (cambio del frontend).

**Verificación**
- ✅ Dependencia `googleapis` instalada y lockfile commiteado.
- ✅ En local: `build`, `lint`, `test` (183) y `test:e2e` (65); migración aplicada.
- ✅ Contra Google real: conexión (token guardado con prefijo `v1.`, scopes `drive` y
  `gmail.modify`), cuenta equivocada (`wrong_account` + `mailboxId`, la casilla sigue
  `needs_reconnect`), cancelar (`access_denied`, sin cambios) y desconectar (204, acceso
  revocado en Google).
- Ajuste posterior: incluir `mailboxId` cuando Google devuelve un error con `state` válido.

### ⏳ Pendiente

- **Fase 4 — Messages/Sent** (Gmail API).
- **Fase 5 — Scheduled messages** (tabla + job periódico).
- **Fase 6 — Templates.**
- **Fase 7 — Drive access** (Drive API).
