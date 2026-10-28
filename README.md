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
| `npm run typecheck` | Chequea tipos de todo el proyecto (incluye tests). **Los tests no chequean tipos** (ver abajo) |
| `npm run lint` | ESLint + Prettier |
| `npm test` | Tests unitarios (`src/**/*.spec.ts`) |
| `npm run test:e2e` | Tests de punta a punta sobre HTTP (`test/*.e2e-spec.ts`) |
| `npm run test:cov` | Unitarios con cobertura |
| `npm run migration:run` / `:revert` / `:show` | Migraciones contra la DB del `.env` |

**Checklist antes de cada commit:** `npm run build && npm run typecheck && npm run lint && npm test && npm run test:e2e`.

Jest corre con `maxWorkers: 50%` y ts-jest usa `tsconfig.spec.json` (`isolatedModules: true`:
solo transpila, sin chequear tipos). Con el chequeo completo en cada proceso, una máquina de
12 núcleos y 16 GB quedaba al 100% de CPU, RAM y disco. Los tipos los siguen chequeando
`build` y `typecheck` (con `tsconfig.json`, sin cambios), por eso están en el checklist.

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
| `MAILBOX_DAILY_RECIPIENT_LIMIT` | No (`500`) | Cupo de destinatarios por casilla en 24 horas (Gmail común ~500; Google Workspace 2000). |
| `SCHEDULED_SENDER_ENABLED` | No (`true`) | Job de envíos programados (cada minuto). Apagarlo en una instancia que no deba enviar (ej. una copia local contra la base de producción). |
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
  messages/               Recibidos, Enviados, Redactar, Responder y adjuntos contra Gmail (Fases 4 y 4.5)
  scheduled-messages/     envíos programados: tabla, borradores de Gmail y job por minuto (Fase 5)
  templates/              plantillas por casilla (Fase 6)
  drive-access/           compartir carpetas y archivos del Drive de una casilla (Fase 7)
  contacts/               contactos y grupos de Google Contacts, solo lectura (Fase 8)
  sync/                   estado de sincronización de cada casilla, para ver mails nuevos sin recargar
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
| `GET /me/mailboxes` | logueado | 1·6 | `Mailbox[]` a las que el usuario tiene algún permiso, con `canRead` y `canSend` |
| `GET /mailboxes/:id/messages` | `canRead` | 4·8·10 | Una página (25) de Recibidos → `{ items: MessageSummary[], nextPageToken }` (con `labelIds`). `?labelId=Label_…` → los de esa etiqueta. `?pageToken=` → la página siguiente |
| `GET /mailboxes/:id/sync-state` | `canRead` | 9 | `{ historyId, scheduledVersion }`: si cambia alguno, hay novedades (mails o programados) y el front vuelve a pedir las listas |
| `GET /mailboxes/:id/labels` | `canRead` | 8 | Etiquetas de usuario de la casilla → `MailLabel[]` (`{ id, name, color }`) |
| `PATCH /mailboxes/:id/messages/:messageId/labels` | `canRead` | 8 | `{ add?, remove? }` (ids de etiqueta) → aplica a la conversación → `{ labelIds }` |
| `GET /mailboxes/:id/messages/:messageId` | `canRead` | 4·8 | `MessageDetail` (cuerpo en texto plano, `cc`, `attachments`); lo marca como leído |
| `GET /mailboxes/:id/messages/:messageId/attachments/:attachmentId` | `canRead` | 4.5 | Descarga un adjunto (recibidos y enviados) |
| `POST /mailboxes/:id/messages` | `canSend` | 4·4.5·8 | Redactar: `{ to, cc?, bcc?, subject, body, forwardedAttachments? }` (destinatarios: emails separados por coma) + adjuntos (`attachments`, multipart). Reenviar adjuntos pide además `canRead`. Cupo diario → 429 `RECIPIENT_LIMIT_EXCEEDED` |
| `POST /mailboxes/:id/messages/:messageId/reply` | `canSend` | 4 | Responder en el mismo hilo: `{ body }` + adjuntos |
| `GET /mailboxes/:id/sent` | `canRead` | 4·10 | Una página (25) de Enviados → `{ items: SentMessageSummary[], nextPageToken }`. `?pageToken=` → la siguiente |
| `GET /mailboxes/:id/sent/:sentId` | `canRead` | 4·8 | `SentMessageDetail` (cuerpo en HTML sanitizado, `cc`, `bcc`, `attachments`) |
| `GET /sent/:sentId` | `canRead` en la casilla | 4 | Para "Reenviar": busca el enviado en las casillas que la persona puede leer |
| `GET /mailboxes/:id/scheduled-messages` | `canRead` | 5 | Programados de la casilla (pendientes, enviándose y con error) → `ScheduledMessage[]` |
| `GET /scheduled-messages/:id` | `canRead` en su casilla | 5 | `ScheduledMessage` (404 si no tiene ningún permiso en la casilla) |
| `GET /scheduled-messages/:id/attachments/:attachmentId` | `canRead` en su casilla | 5 | Descarga un adjunto del programado |
| `POST /scheduled-messages` | `canSend` en `mailboxId` | 5·8 | `{ mailboxId, to, cc?, bcc?, subject, body, scheduledAt, replyToMessageId?, forwardedAttachments? }` + adjuntos (multipart) → 201 |
| `PATCH /scheduled-messages/:id` | `canSend` (y en la casilla nueva) | 5 | Cualquier campo + `keepAttachmentIds` + adjuntos nuevos. Solo `pending`/`failed` (si no, 409) |
| `DELETE /scheduled-messages/:id` | `canSend` en su casilla | 5 | Cancela (borra fila y borrador) → 204. Solo `pending`/`failed` (si no, 409) |
| `GET /mailboxes/:id/templates` | `canSend` | 6 | Plantillas de la casilla, por nombre → `MessageTemplate[]` |
| `POST /mailboxes/:id/templates` | `canSend` | 6 | `{ name, subject?, body }` → `MessageTemplate` (201; 409 `TEMPLATE_NAME_TAKEN` si el nombre ya existe en la casilla) |
| `GET /mailboxes/:id/templates/:templateId` | `canSend` | 6 | `MessageTemplate` (404 si no es de esa casilla) |
| `PATCH /mailboxes/:id/templates/:templateId` | `canSend` | 6 | `{ name?, subject?, body? }` (`subject: null` lo quita) → `MessageTemplate` |
| `DELETE /mailboxes/:id/templates/:templateId` | `canSend` | 6 | Borra → 204 |
| `GET /mailboxes/:id/drive/items?userId=…&folderId=root` | admin | 7 | Contenido de una carpeta del Drive de la casilla → `DriveItem[]` (`shared` = compartido directamente con esa persona; `inherited` = accede por una carpeta) |
| `GET /mailboxes/:id/drive/shared?userId=…` | admin | 7 | Ids de lo compartido directamente con la persona en ese Drive |
| `PUT /mailboxes/:id/drive/access/:userId` | admin | 7 | `{ itemIds }` (selección final) → comparte lo nuevo como Editor y quita lo destildado → `{ added, removed, skipped, failed }` |
| `GET /mailboxes/:id/contact-groups` | `canSend` | 8 | Grupos de Google Contacts de la casilla → `ContactGroup[]` |
| `GET /mailboxes/:id/contact-groups/:groupId/members` | `canSend` | 8 | Miembros con email → `Contact[]` |
| `GET /mailboxes/:id/contacts?q=` | `canSend` | 8 | Sin `q`: todos los de "Mis contactos". Con `q`: búsqueda en Mis contactos + Otros contactos → `Contact[]` |
| `GET /users` | admin | 2 | `AdminUser[]` |
| `POST /users` | admin | 2 | `{ name, email, role, access }` → invita y devuelve `AdminUser` (201; 409 si el email existe) |
| `PATCH /users/:id/permissions` | admin | 2·7 | `{ role, access }` (reemplaza todos los permisos) → `AdminUser`. Las casillas que pierde le quitan lo compartido en su Drive |
| `PATCH /users/:id/deactivate` | admin | 2·7 | Desactiva, banea en Supabase Auth y quita lo compartido en el Drive de sus casillas → `AdminUser` |
| `DELETE /users/:id` | admin | 2·7 | Borra de Supabase Auth (perfil y permisos en cascada) y quita lo compartido en sus Drives → 204 |
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
  - APIs activadas: **Gmail API, Google Drive API y People API**. En la pantalla de
    consentimiento, los permisos `gmail.modify`, `drive`, `contacts.readonly` y
    `contacts.other.readonly`.
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
  `gmail.modify` y `drive` la conexión se rechaza.
- **Al rechazar una conexión, el token recién emitido se descarta y solo se revoca si la
  cuenta de Google es conocida y no pertenece a ninguna casilla con credenciales.**
  Revocar en Google revoca el permiso de toda la cuenta para la app, no solo ese token.
  Bug encontrado en la verificación de la Fase 4: conectar Secretaría con la cuenta de
  Tesorería (`wrong_account`) revocaba el permiso y dejaba a Tesorería sin credenciales.
  Lo mismo pasaría al reconectar una casilla destildando un permiso (`missing_scopes`).
  Si la cuenta no se puede identificar, tampoco se revoca: como mucho queda un permiso
  sin usar en esa cuenta, que se puede quitar desde myaccount.google.com/permissions.
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

### ✅ Fase 4 — Recibidos, Enviados, Redactar y Responder (Gmail API)

**Qué se construyó**
- Módulo `messages/`: endpoints de la tabla de arriba, todos detrás de
  `@RequireMailboxAccess` (`read` para leer, `send` para enviar y responder).
- Parseo de Gmail (`gmail/gmail-message.ts`): direcciones, encabezados (incluye
  RFC 2047), cuerpos en partes anidadas con su charset, entidades del `snippet`, fechas.
- Contenido (`content/html-content.ts`): sanitizador de HTML (`sanitize-html`) y
  conversión HTML ↔ texto (`html-to-text`).
- Armado del mensaje (`gmail/mime.ts`) con el generador MIME de `nodemailer`; el envío lo
  hace la Gmail API como subida `message/rfc822`.
- Adjuntos: `multipart/form-data`, campo `attachments`, hasta 10 archivos y 20 MB en total.
- Jest más liviano (`maxWorkers: 50%`, `tsconfig.spec.json` con `isolatedModules`).
- **`sanitize-html` en su última versión + Jest transformando sus dependencias ESM.**
  Desde la 2.17.2 depende de `htmlparser2@10/12`, que es solo ESM: la app funciona igual
  (Node 24 carga ESM desde CommonJS), pero Jest no puede importarlo y las suites que lo usan
  fallaban con `Cannot use import statement outside a module`. Se descartó fijar la 2.17.1
  (la última con `htmlparser2@8`): es la barrera contra XSS y quedaría sin los arreglos de
  seguridad que salgan. En su lugar, `transformIgnorePatterns` deja que ts-jest
  (`allowJs` en `tsconfig.spec.json`) transforme `htmlparser2`, `domhandler`, `domutils`,
  `dom-serializer`, `domelementtype` y `entities`, también cuando están anidados.
- Tests unitarios (parseo, sanitizador, MIME, adjuntos, concurrencia, servicio con Gmail
  simulado) y e2e (permisos read/send, validaciones, multipart, límites).

**Decisiones**
- **Recibidos: cuerpo en texto plano.** El frontend lo muestra como texto (`{message.body}`);
  devolver HTML mostraría etiquetas y abriría la puerta a XSS. Se usa la parte
  `text/plain`, o el HTML sanitizado convertido a texto.
- **Enviados: cuerpo en HTML sanitizado en el backend.** El frontend lo renderiza con
  `dangerouslySetInnerHTML`, y Enviados también tiene mails mandados desde Gmail y
  reenvíos con HTML de terceros. Se quitan scripts, iframes, formularios, `on*`,
  `javascript:` y CSS de posicionamiento; los links abren con `rel="noopener noreferrer"`.
  Lo que se envía desde Redactar/Responder pasa por el mismo filtro.
- **Abrir un recibido lo marca como leído** (como Gmail). Si eso falla, igual se muestra.
- **Responder** va a `Reply-To` (o `From`), con "Re: " sin duplicar e `In-Reply-To` /
  `References`, en el mismo `threadId`: Gmail lo agrupa en el hilo.
- **Remitente:** `"<nombre visible de la casilla>" <email de la casilla>`.
- **Sin paginación:** el contrato devuelve un array; se traen los 25 más recientes, con
  5 pedidos de detalle en paralelo como máximo (cuota de la Gmail API). Pendiente:
  `?pageToken=`.
- **`GET /sent/:sentId`** prueba en cada casilla con `canRead` hasta encontrarlo (saltea las
  desconectadas). Mejor sería que el frontend mande la casilla (pendiente de contrato).
- **Errores:** mensaje inexistente → 404; casilla sin conexión válida → 409
  `mailbox_needs_reconnect`; otro error de Google → 502; id con formato inválido → 400;
  adjuntos de más → 400; adjuntos que superan 20 MB → 413.
- **Adjuntos de mensajes recibidos: no se exponen** (el contrato no los incluye). Se suman en la Fase 4.5.

**Cambios de contrato con el frontend (para la mini-fase front↔back)**
- Redactar/Responder: multipart con los archivos en `attachments` (o JSON sin adjuntos).
- Recomendado: que "Reenviar" pase también la casilla (`/compose?forward=<id>&mailbox=<id>`).

**Verificación**
- ✅ Dependencias instaladas y lockfile commiteado. `build`, `typecheck` y `lint` pasan.
- ❌→ corregido: `test`/`test:e2e` fallaban por las dependencias ESM de `sanitize-html` (ver
  arriba) y ts-jest avisaba que la opción `isolatedModules` está deprecada (ahora va en
  `tsconfig.spec.json`, sin warning). Con `maxWorkers: 50%` Jest abre 6 procesos y la CPU no
  pasa del 74%.
- ✅ `test` y `test:e2e` pasan.
- ✅ Contra Gmail: listar y abrir recibidos (se marcan como leídos), listar y abrir
  enviados, redactar con y sin adjuntos, responder (queda en el mismo hilo), permisos.

### ✅ Fase 4.5 — Adjuntos completos (ver, descargar y reenviar)

**Qué se construyó**
- `MessageDetail` y `SentMessageDetail` suman `attachments: { id, filename, mimeType, size }[]`.
- `GET /mailboxes/:id/messages/:messageId/attachments/:attachmentId` (`canRead`): baja el
  archivo como descarga (`Content-Disposition: attachment`, nombre con tildes vía
  `filename*`). Sirve para recibidos y enviados: Gmail usa los mismos ids.
- Reenviar con los adjuntos originales: Redactar acepta
  `forwardedAttachments: [{ messageId, attachmentId }]` y el backend los baja de Gmail y
  los vuelve a adjuntar, sin que el navegador los suba de nuevo. Por multipart va como JSON
  en un campo (o `forwardedAttachments[0][messageId]=…`).
- Errores de adjuntos en español: "Máximo 10 adjuntos", "Los adjuntos superan los 20 MB en
  total", archivos en otro campo. Antes llegaban los de multer en inglés ("Too many files").
- `MessagesService` se partió en piezas reutilizables (armar el MIME, resolver la respuesta,
  juntar adjuntos, borradores de Gmail) y se exporta: lo usa la Fase 5.

**Decisiones**
- **El id del adjunto es el `partId` de Gmail** ("1", "0.2"), no el `attachmentId`: este
  último es larguísimo y cambia en cada lectura del mensaje. Descargar cuesta un pedido
  más (leer el mensaje para ubicar la parte), a cambio de ids cortos y estables.
- **Reenviar adjuntos pide `canRead` además de `canSend`**: bajar un adjunto de la casilla
  es leerla. Sin eso, alguien con solo `canSend` podría mandarse cualquier archivo de la
  casilla conociendo su id.
- **Solo de la misma casilla**: los adjuntos se buscan en la casilla desde la que se envía;
  un id de otra casilla da 400 ("no existe en esta casilla").
- **Los límites cuentan todo junto** (subidos + reenviados) y se validan con el tamaño que
  informa Gmail, antes de bajar nada.
- Un mail adjunto (`.eml`) cuenta como un adjunto; no se listan sus partes internas. Las
  imágenes embebidas con nombre también aparecen en la lista.

**Cambios de contrato con el frontend (para la mini-fase front↔back)**
- Detalle de recibidos/enviados: mostrar `attachments` con link a la descarga.
- "Reenviar": pasar la casilla y mandar `forwardedAttachments` con los adjuntos del original.

**Verificación**
- ✅ `lint`, `typecheck`, `test`, `test:e2e`.
- ❌→ corregido: con Nest 11.2 el mensaje de multer llega como `"Unexpected field - <campo>"`
  (y multer nuevo dice `"Unexpected file field"`), así que la traducción por texto exacto no
  coincidía. Ahora se compara el comienzo del mensaje.
- ✅ Contra Gmail: ver y bajar adjuntos con tildes en el nombre (`filename*` UTF-8), reenviar
  con `forwardedAttachments`, 11 adjuntos → 400 "Máximo 10 adjuntos".

### ✅ Fase 5 — Envíos programados

**Qué se construyó**
- Tabla `scheduled_messages` (migración `1791100000000-CreateScheduledMessages`, con el
  cerrojo de RLS) y los endpoints de la tabla de arriba.
- **El mensaje se guarda como borrador de Gmail en la casilla** (con sus adjuntos): se crea
  al programar, se actualiza al editar y se borra al cancelar. La tabla guarda lo necesario
  para listarlo (destinatario, asunto, HTML sanitizado, lista de adjuntos, fecha, estado).
- Job (`ScheduledSenderService`) en el mismo proceso de la API, **cada minuto**:
  1. marca `failed` los que quedaron `sending` hace más de 10 minutos (el proceso se cortó
     enviando): no se reenvían solos, porque Gmail pudo haberlos mandado;
  2. toma hasta 20 vencidos con `FOR UPDATE SKIP LOCKED` y los pasa a `sending` en la misma
     sentencia;
  3. envía cada borrador con `drafts.send` y guarda el id del mensaje enviado.
- Respuestas programadas (`replyToMessageId`): destinatario, asunto e hilo salen del
  original, igual que Responder.
- Reenviar adjuntos también al programar (`forwardedAttachments`, pide `canRead`).
- Variable `SCHEDULED_SENDER_ENABLED` para apagar el job en una instancia.

**Decisiones**
- **No hace falta tener la sesión abierta**: el envío lo hace el backend (que en Railway está
  siempre prendido) con el permiso de Google de la casilla. En local, el backend tiene que
  estar corriendo a la hora programada.
- **Por qué un borrador de Gmail** y no archivos en la base o en un storage: los adjuntos
  pueden pesar 20 MB y Gmail ya los guarda, sin costo ni infraestructura nueva. Además
  enviar un borrador es idempotente: si Gmail ya lo mandó, el borrador no existe más y un
  reintento falla en vez de duplicar el mail. Contra: el borrador se ve en la carpeta
  Borradores de la casilla. **Si alguien lo toca desde Gmail:**
  - lo borra con el tachito → el borrador va a la Papelera, pero para la API sigue
    existiendo y `drafts.send` lo enviaría igual. Por eso, antes de enviar, el job revisa
    la etiqueta `TRASH`: si está, queda `failed` ("se eliminó desde Gmail… editalo y se
    vuelve a programar"). Editarlo crea un borrador nuevo fuera de la Papelera (con los
    adjuntos copiados del viejo) y elimina el viejo;
  - lo elimina para siempre o lo envía a mano → el borrador ya no existe (404) y queda
    `failed` ("el borrador ya no existe… revisá Enviados").
- **Estados**: `pending` → `sending` → `sent`, o `failed` con `lastError`. Los `sent` no
  aparecen en la lista (ya están en Enviados). Editar uno `failed` lo vuelve a `pending`; si
  no se le cambia la fecha y ya pasó, sale en la próxima vuelta (sirve de "reintentar").
- **Reintentos**: un error transitorio de Google (502) se reintenta a 1, 5 y 15 minutos; al
  cuarto intento queda `failed`. Casilla desconectada (`needs_reconnect`) o borrador
  inexistente → `failed` enseguida, sin reintentos.
- **Fecha**: entre 1 minuto y 1 año desde ahora (ISO 8601 con zona; la guarda en UTC).
- **Permisos**: ver pide `canRead`; crear, editar y cancelar, `canSend`. Sin ningún permiso
  sobre la casilla → 404 (no se revela que existe). **Al enviar** se vuelve a chequear que la
  última persona que lo programó o editó siga activa y con `canSend`: si le sacaron el
  permiso o la desactivaron, no sale (`failed`).
- **Editar y cancelar no chocan con el job**: editar reserva la fila (`locked_until`, 2
  minutos) y el job no toma filas reservadas; cancelar es un `DELETE` condicional. Si el job
  ya la tomó → 409.
- **Adjuntos al editar**: `keepAttachmentIds` omitido conserva todos; `[]` ninguno; los
  archivos nuevos y los reenviados se suman. Si el borrador ya no existe y había adjuntos →
  400 (hay que volver a adjuntarlos; no se pierden en silencio).
- **Mover de casilla** crea el borrador en la nueva y borra el viejo (pide `canSend` en las
  dos). Una respuesta no se puede mover (el hilo es de la casilla original).
- **Un job sin librería** (`setInterval` en el ciclo de vida de Nest) en vez de
  `@nestjs/schedule`: la versión actual de esa librería es solo ESM (el mismo problema de
  Jest que `sanitize-html`) y para "cada minuto" no hace falta más. Sin dependencias nuevas.
- **Con varias instancias** no se duplican envíos (`SKIP LOCKED` + estado `sending`).
- Fuera de alcance: avisar por mail cuando un programado falla.

**Cambios de contrato con el frontend (para la mini-fase front↔back)**
- `ScheduledMessage` suma `status`, `lastError`, `attachments`, `replyToMessageId` y `sentAt`.
- Programar desde Redactar/Responder: `POST /scheduled-messages` con los adjuntos (multipart)
  y, desde Responder, `replyToMessageId`.
- "Editar" muestra los adjuntos que ya tiene (y manda `keepAttachmentIds`); "Cancelar" es
  `DELETE`. Mostrar el estado `failed` con su motivo.

**Verificación**
- ✅ Migración aplicada; `lint` (tras pasar a `dataSource.query<T>()`), `typecheck`, `test`
  (328) y `test:e2e` (116).
- ✅ Contra Gmail: programado con adjunto (borrador → `pending` → enviado a horario con menos
  de 1 minuto de demora), editar (cambia el borrador), cancelar (204, borra el borrador),
  respuesta programada en el mismo hilo.
- ❌→ corregido: borrar el borrador con el tachito lo manda a la Papelera, donde sigue
  existiendo para la API, y el programado se enviaba igual. Ahora se revisa `TRASH` antes de
  enviar (ver Decisiones). ✅ Verificado: al tacho → `failed` sin enviar; editarlo → borrador
  nuevo con el adjunto, el viejo sale de la Papelera y se envía a horario; eliminado para
  siempre → `failed` ("el borrador ya no existe").

### ✅ Fase 6 — Plantillas

**Qué se construyó**
- Tabla `templates` (migración `1791200000000-CreateTemplates`, con el cerrojo de RLS) y los
  endpoints de la tabla de arriba.
- `MessageTemplate`: `{ id, mailboxId, name, preview, subject, body }`. `preview` lo calcula
  el backend (el comienzo del cuerpo en una línea, hasta 80 caracteres).
- Tests unitarios (servicio, preview, nombres repetidos, límite) y e2e (permisos y validaciones).

**Decisiones**
- **Se crean en la app, no se leen de Gmail**: la Gmail API no da acceso a las plantillas de
  Gmail (Redactar → ⋮ → Plantillas). Las que ya existan ahí se copian a mano una vez.
- **Las usa y las gestiona cualquiera con `canSend` en la casilla**: son quienes redactan, y
  no suma trabajo al admin. Con solo `canRead` no se ven (el selector está en Redactar). Como
  en el resto, ser admin no da acceso implícito.
- **Por casilla**: cada casilla tiene las suyas; borrar la casilla borra sus plantillas.
- **Asunto opcional** (`subject`): si la plantilla lo tiene, al elegirla se completa también
  el asunto. Vacío o `null` = sin asunto.
- **Nombre único por casilla, sin distinguir mayúsculas** (índice sobre `lower(name)`) → 409.
  Hasta 100 caracteres; hasta 100 plantillas por casilla.
- **El cuerpo pasa por el mismo sanitizador que Redactar** y tiene el mismo límite.
- **Sin variables**: textos como `[fecha]` quedan como texto común y se completan al redactar.
- **`preview` es el comienzo del cuerpo**, no solo la primera línea: la primera línea suele
  ser un saludo ("Hola,") que no distingue una plantilla de otra.

**Cambios de contrato con el frontend (para la mini-fase front↔back)**
- `MessageTemplate` suma `subject` (o `null`) y `mailboxId`; al elegir una con asunto,
  completar también el asunto. La pantalla Plantillas del front (Anexo 4) tiene que sumar el
  campo "Asunto (opcional)".

**Ajuste al contrato del front (Anexo 4, pantalla Plantillas)**
- Detalle, edición y borrado pasan a `/mailboxes/:mailboxId/templates/:templateId` (se sacó
  `/templates/:id`): el permiso lo chequea el mismo guard de casilla que en el resto, y una
  plantilla de otra casilla → 404.
- Nombre de 1 a 60 caracteres, **único sin distinguir mayúsculas ni tildes** ("Confirmación"
  y "confirmacion" chocan): columna `name_key` con el nombre normalizado e índice único
  (migración `1791400000000-TemplateNameKey`, que completa las existentes y, si dos solo se
  diferenciaban por tildes, le agrega " (2)" a la segunda). Repetido → 409 con
  `code: 'TEMPLATE_NAME_TAKEN'`.
- `preview` de 48 caracteres. La respuesta suma `updatedAt` y `updatedByName` (null si esa
  persona se borró), para "Editada por … · fecha".
- **Permisos: se mantiene `canSend`** (no "cualquier acceso", como asumía el front): las
  plantillas se usan en Redactar. Para que el front sepa qué mostrar, `GET /me/mailboxes`
  suma `canRead` y `canSend`; la pantalla Plantillas lista solo las casillas con `canSend`
  (y Redactar también debería ofrecer solo esas).
- ✅ Verificado: migración `TemplateNameKey` (con plantillas previas: completó `name_key` y
  renombró "accion rapida" a "accion rapida (2)" porque chocaba con "Acción rápida"), `lint`,
  `typecheck`, `test` (427), `test:e2e` (171); crear, nombre repetido sin tildes → 409
  `TEMPLATE_NAME_TAKEN`, editar y ver por id bajo la casilla, borrar, ruta vieja → 404 y
  `/me/mailboxes` con `canRead`/`canSend`.

**Verificación**
- ✅ Migración aplicada; `lint`, `typecheck`, `test` (342) y `test:e2e` (130).
- ✅ Contra la API: crear (con `preview` y el `<script>` quitado), sin asunto → `null`, lista
  ordenada sin distinguir mayúsculas, nombre repetido en otras mayúsculas → 409, quitar el
  asunto con `subject: null`, borrar → 204. Sin `canSend` (admin con solo lectura en una
  casilla) → lista 403 y detalle 404.

### ✅ Fase 7 — Acceso a Drive

**Qué se construyó**
- Módulo `drive-access/` con los endpoints de la tabla de arriba (solo admin), para
  "Gestionar Drive" en Editar permisos: explorar el Drive de la casilla de a una carpeta y
  elegir qué se comparte con una persona. Usa el permiso de Google de la casilla (el scope
  `drive` se pidió en la Fase 3).
- Guardar recibe la selección final, la compara con lo que ya está compartido, comparte lo
  nuevo y quita lo destildado. Cada ítem se aplica por separado: lo que falla vuelve en
  `failed` con el motivo y el resto se aplica igual.
- **Revocación automática** en `UsersService`: cuando una persona pierde por completo una
  casilla (cambio de permisos), la desactivan o la borran, se le quita todo lo compartido en
  el Drive de esa casilla.
- Tests unitarios (comparación, filtros de seguridad, errores de Google, revocación) y e2e
  (solo admin, validaciones).

**Decisiones**
- **Se comparte como Editor** (decisión de la fase): hoy todos entran con la contraseña y
  tienen acceso total; con Lector se cortarían usos normales. El front no tiene selector.
- **Drive es la fuente de verdad, sin tabla propia**: "compartido" = esa cuenta tiene un
  permiso **propio** (lectura o edición) sobre el ítem en Drive. Lo compartido a mano desde
  Drive también aparece tildado, y destildarlo en la app lo quita.
- **Permisos heredados**: el contenido de una carpeta compartida también figura en Drive con
  acceso para esa persona, pero heredado (Google no deja borrarlo: se va con la carpeta).
  Esos ítems vienen `shared: false, inherited: true` (sin tildar) y nunca se intenta
  quitarlos. Para distinguirlos: un ítem cuya carpeta también está compartida se revisa con
  `permissionDetails`; si Google no lo informa (en Mi unidad no siempre viene), se toma como
  heredado. Si igual Google responde "inherited" al quitar, el motivo dice que hay que dejar
  de compartir la carpeta, y en la revocación automática no cuenta como falla.
- **Compartir aparte algo que ya cubre una carpeta**: en Mi unidad, si la persona ya hereda
  Editor de la carpeta, Drive no crea un permiso propio aunque `permissions.create` responda
  OK. Por eso no se pide: el ítem vuelve en `skipped` ("Ya tiene acceso como Editor por la
  carpeta que lo contiene"), ni en `added` ni en `failed`. Si lo que hereda es solo Lector
  (una carpeta compartida a mano), sí se comparte como Editor.
- **Solo se tocan ítems de los que la casilla es dueña** (`'me' in owners`): nunca se le quita
  a nadie un acceso que le dio otra persona, ni el permiso de dueño.
- **La persona tiene que tener acceso a la casilla en la app** (si no, 400) y estar activa
  para compartirle (si no, 409). Mi unidad entera, ítems en la papelera o de otro dueño → en
  `failed` con el motivo.
- **Google le avisa por mail** a la persona cuando le comparten algo (lo encuentra en
  "Compartidos conmigo").
- **`+alias` de Gmail**: `ana+algo@gmail.com` es la misma cuenta de Google que
  `ana@gmail.com`, así que Drive comparte con la cuenta. Las búsquedas y comparaciones se
  hacen sin el `+algo`. Ojo al probar con alias: dos usuarios de la app con alias de la misma
  cuenta son, para Drive, la misma persona.
- **La revocación nunca frena el cambio en la app**: primero se aplica el cambio de
  permisos, la desactivación o el borrado; después se quita lo de Drive. Si Google falla (o la
  casilla necesita reconectarse), queda en el log con cuántos ítems no se pudieron quitar,
  para hacerlo a mano. Desactivar conserva los permisos en la app (por si se reactiva), pero
  el Drive se quita igual.
- **El admin ve nombres de carpetas y archivos de la casilla** (no contenidos) aunque no
  tenga `canRead`: es su herramienta de gestión, como la diseñó el front.

**Cambios de contrato con el frontend (para la mini-fase front↔back)**
- `shared` y "lo ya compartido" son **por persona**: el explorador y `getDriveSharedItemIds`
  tienen que mandar `userId` (en el mock no dependían de la persona).
- `DriveItem` suma `inherited`: mostrar esos ítems como "acceso por carpeta", sin casilla
  para tildar. El resultado de guardar suma `skipped` (no es un error).
- `updateDriveAccess` → `PUT /mailboxes/:id/drive/access/:userId` con `{ itemIds }`; mostrar
  los `failed` con su motivo en vez de un "ok" a secas.

**Verificación**
- ✅ `lint`, `typecheck`, `test` (362), `test:e2e` (143). No hay migración en esta fase.
- ✅ Contra Drive (con una cuenta de Gmail real, rol user con `canRead` en Tesorería):
  explorar Mi unidad y una carpeta, compartir carpeta + archivo (llegan los mails de Google y
  queda como Editor), `/drive/shared`, archivo en la papelera → `failed` "Está en la
  papelera", quitar la casilla en permisos revoca el acceso, usuario común → 403.
- ❌→ corregido: el contenido de una carpeta compartida contaba como compartido (la búsqueda
  de Drive devuelve también lo heredado); en cada guardado y en la revocación se intentaba
  borrar ese permiso heredado y Google lo rechazaba (errores falsos en `failed`, con el motivo
  cortado y sin nombre). Ahora se separa directo de heredado (ver Decisiones).
- ❌→ corregido: compartir un archivo de adentro de una carpeta ya compartida respondía
  `added`, pero Drive no creaba el permiso propio. Ahora va a `skipped` (ver Decisiones).
- ✅ Re-verificado tras las correcciones (`lint`, `typecheck`, `test` 371, `test:e2e` 143):
  compartir la carpeta → `added`; carpeta + archivo de adentro → archivo en `skipped`;
  `/drive/shared` solo con la carpeta; `[]` → `removed` sin fallas; quitar la casilla revoca
  sin advertencias en el log.

### ✅ Fase 8 — Varios destinatarios, cupo diario, etiquetas y contactos

(Anexo 3 del front; secciones 6.11 y 6.12 del brief, que ahí figuran como "Fase 7".)

#### 8.1 Varios destinatarios (to / cc / bcc) y cupo diario

**Qué se construyó**
- Redactar y programados reciben `to`, `cc` y `bcc`, cada uno un string de emails separados
  por coma (el formato del header de Gmail). Pueden venir vacíos, pero entre los tres tiene que
  haber al menos uno (también se valida acá). Se acepta coma o punto y coma y `Nombre <email>`.
- El mensaje se arma con los headers `To`, `Cc` y `Bcc`. **El `Bcc` va dentro del mensaje que
  recibe la Gmail API**: Gmail lo usa para entregar y lo saca antes de mandarlo. nodemailer lo
  omite por defecto, así que se activa a propósito (`keepBcc`).
- Repetidos: se sacan sin distinguir mayúsculas; si una dirección está en dos campos, queda en
  el más visible (to > cc > bcc) para que nadie lo reciba dos veces. Hasta 500 por mensaje.
- Programados guardan `cc`, `bcc` y `recipient_count` (migración
  `1791300000000-AddRecipientsAndSendLog`). En una respuesta programada `to` sale del original;
  `cc` y `bcc` se respetan.
- **Cupo diario** (`SendQuotaService`): tabla `mailbox_send_log` con cada envío hecho desde la
  app y su cantidad de destinatarios. Se suma una ventana móvil de 24 horas (como Gmail) contra
  `MAILBOX_DAILY_RECIPIENT_LIMIT` (500 por defecto). Si un envío no entra: **429**
  `{ code: 'RECIPIENT_LIMIT_EXCEEDED', limit, remaining, requested, message }`.
  - Redactar y Responder: se valida antes de ir a Google y se descuenta al enviar.
  - Programados: se valida al programar y al editar, y **de nuevo cuando el job lo dispara**;
    si ahí no alcanza, queda `failed` con "Se superó el cupo diario… quedan N. Editalo para
    reprogramarlo." (no se reintenta solo).

**Decisiones**
- **Solo se cuenta lo que sale desde la app**: lo que se mande directo desde Gmail no se ve. Por
  eso, si Gmail igual rechaza por su propio cupo (`dailyLimitExceeded`), se informa con el
  mismo `RECIPIENT_LIMIT_EXCEEDED` (con `remaining: 0`).
- Dos envíos simultáneos podrían pasarse por poco del cupo de la app (no hay reserva); Gmail
  igual pone el límite real.
- Responder cuenta 1 destinatario.
- **Detalle con copias**: `MessageDetail` suma `cc` y `SentMessageDetail` suma `cc` y `bcc`
  (headers tal cual, `''` si no hay). En un recibido no hay Bcc (Gmail no lo muestra); en la
  copia de Enviados sí lo guarda, y solo lo ve quien tiene `canRead` en la casilla.

#### 8.2 Etiquetas de Gmail

**Qué se construyó** (dentro de `messages/`, sin entidad propia)
- `GET /mailboxes/:id/labels`: las etiquetas **creadas por el usuario** (no las de sistema), por
  nombre, con `color` = el color de fondo de Gmail o `null` (el front le pone uno de su paleta).
- `PATCH …/messages/:messageId/labels` con `{ add, remove }`: se aplica a la **conversación**
  (`threads.modify`), igual que Gmail; las respuestas nuevas del hilo la heredan. Devuelve
  `{ labelIds }` como quedó.
- `MessageSummary` / `MessageDetail` suman `labelIds` (solo las de usuario).
- `GET /mailboxes/:id/messages?labelId=…`: los mensajes de esa etiqueta, estén o no en Recibidos.

**Decisiones**
- **Solo etiquetas de usuario** (ids `Label_…`): con las de sistema (`INBOX`, `TRASH`, `SPAM`…)
  "etiquetar" sería archivar o borrar. Una etiqueta que no es de la casilla → 400; la misma en
  `add` y `remove` → 400.
- **Pide `canRead`**: etiquetar es organizar lo que ya se lee, no enviar.
- Crear, renombrar o borrar etiquetas queda fuera (se hace desde Gmail).
- El filtro del front hoy es local sobre los 25 cargados; `?labelId=` permite traer los de una
  etiqueta desde Gmail (sugerido para la conexión con el front).

#### 8.3 Contactos y grupos (People API)

**Qué se construyó** (módulo nuevo `contacts/`, solo lectura, pide `canSend`)
- `GET …/contact-groups`: los grupos creados por el usuario (no los de sistema como
  "Destacados"), por nombre, con `memberCount` de Google.
- `GET …/contact-groups/:groupId/members`: los miembros **con email** (sin email no sirven para
  enviar; por eso pueden ser menos que `memberCount`), con su email principal.
- `GET …/contacts`: sin `q`, todos los de "Mis contactos" (el front arma con eso el
  autocompletado y "Todos los contactos"); con `q`, busca en "Mis contactos" y en **"Otros
  contactos"** (a quienes la casilla ya les escribió), sin repetidos, hasta 20.
- Permisos de Google nuevos: `contacts.readonly` y `contacts.other.readonly`.

**Decisiones**
- **Los permisos de Contactos son opcionales al conectar**: Google ahora deja destildar permisos
  uno por uno. Sin Gmail o Drive la conexión se rechaza como antes (`missing_scopes`); sin
  Contactos la casilla conecta igual y solo estos endpoints responden **409
  `mailbox_missing_scope`** ("Reconectá la casilla para dar acceso a Contactos"). Lo mismo
  pasa con las casillas conectadas antes de esta fase: hay que reconectarlas una vez. Sin
  `contacts.other.readonly`, la búsqueda usa solo "Mis contactos".
- **Caché de 5 minutos** en memoria para grupos, miembros y la lista completa, por la cuota
  de la People API (pedidos por minuto, gratis). Un contacto recién agregado en Google puede
  tardar ese tiempo en aparecer. La búsqueda con `q` no se guarda.
- La búsqueda de Google necesita un pedido "en vacío" antes (si no, las primeras vuelven
  vacías): se hace una vez por hora y por casilla.
- Si Google corta por cuota → **429 `GOOGLE_RATE_LIMITED`** ("probá en unos segundos").
- Topes: 1000 miembros por grupo y 10.000 contactos por casilla.
- Crear o editar contactos y grupos queda fuera (se hace en Google Contacts).

**Cambios de contrato con el frontend (para la mini-fase front↔back)**
- Redactar y programados: `{ to, cc, bcc }` como ya los manda el front. El 429
  `RECIPIENT_LIMIT_EXCEEDED` trae `limit`, `remaining` y `requested` para el aviso.
- `ScheduledMessage` suma `cc` y `bcc`; un programado puede quedar `failed` por cupo.
- Etiquetas: `PATCH …/labels` devuelve `{ labelIds }`; opcional usar `?labelId=` para filtrar
  desde Gmail en vez de sobre los 25 cargados.
- Contactos: mostrar "Reconectá la casilla" ante 409 `mailbox_missing_scope` y "probá en unos
  segundos" ante 429 `GOOGLE_RATE_LIMITED`. Hoy el front no usa `?q=`: si quiere sumar "Otros
  contactos" al autocompletado, conviene buscar con `q` esperando ~300 ms después de tipear.

**Para probar (una vez, en el proyecto de Google Cloud de desarrollo)**
1. Activar la **People API**.
2. En la pantalla de consentimiento (Data Access / Scopes), agregar `contacts.readonly` y
   `contacts.other.readonly`.
3. Reconectar las dos casillas desde la app (con `POST /mailboxes/:id/reconnect`).

**Verificación (toda la Fase 8)**
- ✅ Migración `AddRecipientsAndSendLog` aplicada; `lint`, `typecheck`, `test` (427),
  `test:e2e` (165).
- ❌→ corregido: lint (`no-base-to-string`), `to` quedaba obligatorio en el tipo de
  `CreateScheduledMessageDto` y dos e2e usaban `cc` como "campo de más" (ahora es válido).
- ✅ Contra Google: 409 `mailbox_missing_scope` antes de reconectar y reconexión con los
  permisos de Contactos; to + cc + bcc llega a todos y el Bcc no se ve; sin destinatarios o con
  un email inválido → 400; con límite 3, un envío a 4 → 429 `RECIPIENT_LIMIT_EXCEEDED`;
  programado con cc/bcc enviado a horario; etiquetas (listar, agregar, `labelIds`, sacar,
  `INBOX` → 400); contactos (grupos, miembros, lista y búsqueda con `q`); `cc`/`bcc` en el
  detalle de enviados y `cc` en el de recibidos.

### 🔧 Ajuste — Nombres de adjuntos (prueba del front, 27/10)

La primera prueba del front conectado encontró dos fallos con los nombres de los adjuntos.

**Qué se arregló**
- **Nombres con tildes o ñ al subir**: "prueba-ñ.txt" quedaba "prueba-Ã±.txt" en Gmail.
  Multer lee el nombre del archivo como latin1 si no se le indica otra cosa, y los navegadores
  lo mandan en UTF-8. Ahora el interceptor de adjuntos usa `defParamCharset: 'utf8'`. Afecta
  a Redactar, Responder, programar y editar programados. Los mails ya enviados quedan con el
  nombre roto.
- **Al descargar se perdía el nombre** ("adjunto (1).pdf"): la descarga va del navegador al
  backend, que está en otro origen, y el navegador oculta `Content-Disposition` si CORS no lo
  expone. Ahora CORS manda `Access-Control-Expose-Headers: Content-Disposition`. Vale para los
  adjuntos de mensajes y de programados, en local y en producción (Vercel → Railway).
- La configuración de CORS pasó a `corsOptions()` en `src/config/cors.ts`, y los e2e la usan
  igual que producción.

**Verificación**
- Tests nuevos: nombre "Cotización año 2026.pdf" por multipart llega igual al servicio (e2e);
  la descarga pedida con `Origin` del front expone `Content-Disposition` (e2e);
  `corsOptions` (unit).
- ✅ `lint` (sin warnings nuevos), `typecheck`, `test` (428), `test:e2e` (173). `build` queda
  para antes del deploy (reescribe `dist/`, que usaba el backend en marcha).
- ✅ En el front: adjunto "prueba-ñ-acción.txt" enviado y visto bien en Enviados; descargas
  guardadas con su nombre ("Cotización año 2026.pdf"); la respuesta trae
  `Access-Control-Expose-Headers: Content-Disposition`; un programado con "programado-ñandú.txt"
  salió a horario con el nombre bien.

### ✅ Fase 9 — Mails nuevos sin recargar

**Qué se construyó**
- `GET /mailboxes/:id/sync-state` (`canRead`) → `{ historyId, scheduledVersion }`.
  - `historyId` es el de Gmail (`users.getProfile`): cambia con cualquier novedad de la
    casilla (llega un mail, se envía, se lee, se etiqueta).
  - `scheduledVersion` cambia al crear, editar, cancelar, enviar o fallar un programado
    (cantidad de filas + última modificación).
- El front lo consulta cada 60 segundos con la pestaña visible, y al volver a ella. Si algo
  cambió, vuelve a pedir las listas. Tiene además un botón "Actualizar".

**Decisiones**
- **Preguntar cada minuto, no push de Gmail (Pub/Sub).** El push es instantáneo, pero suma
  Google Cloud Pub/Sub, renovar la suscripción cada 7 días y conexiones abiertas en Railway.
  Para pocas personas con la app abierta no hace falta.
- **Barato a propósito.** `getProfile` cuesta 1 unidad de cuota de Gmail; volver a pedir
  Recibidos, unas 100. Las listas se piden solo cuando cambió algo. 10 personas con la app
  abierta todo el día son unos 5.000 pedidos por día, lejos del límite.
- Sin acceso implícito para admin, como el resto de la casilla.

**Verificación**
- Tests nuevos: `SyncStateService` (unit: historyId, versión de programados, errores de
  Google) y `sync-state` (e2e: 200 con canRead, 403 sin acceso y para admin, 400, 401).
- ✅ `lint` (sin errores), `typecheck`, `test` (431), `test:e2e` (176), `build`.
- ✅ Con el front: un mail mandado a secretaría apareció solo, sin recargar, a los 13 segundos;
  con la pestaña oculta no se consulta.

### Fase 10 — Ver más de 25 mails

**Qué se construyó**
- Recibidos (también filtrado por etiqueta) y Enviados devuelven una página:
  `{ items, nextPageToken }`. Con `?pageToken=<nextPageToken>` se pide la siguiente; `null` = no
  hay más. Es el `pageToken` de `users.messages.list` de Gmail.
- `pageToken` inválido (caracteres raros, repetido) → 400.

**Cambio de contrato**: antes devolvían un array. El front se actualiza en la misma ronda
(`feat/conexion-backend`): botón "Cargar más" al final de la lista.

**Decisiones**
- **Páginas de 25 y "Cargar más", no todo de una.** Cada mail de la lista es un pedido a Gmail
  (los encabezados); traer 1000 de una sería lento y gastaría cuota.
- **Programados no se pagina**: sale de la base y el volumen esperado es chico.

**Verificación**
- Tests: unit (pageToken y nextPageToken en Recibidos y Enviados) y e2e (`?pageToken=` llega al
  servicio, la respuesta trae `nextPageToken`, pageToken inválido → 400).
- ⏳ `lint`, `typecheck`, `test`, `test:e2e`, `build`.
- ⏳ Con el front: "Cargar más" en Enviados de tesorería (tiene más de 25).

### ⏳ Pendiente

- **Mini-fase front↔back**: conectar el frontend al backend (los cambios de contrato están en
  cada fase).
- **Deploy en Railway** (ver "Puesta en producción").
