import * as Joi from 'joi';

/**
 * Esquema de variables de entorno. Si falta una obligatoria o tiene un formato
 * inválido, la app no arranca (falla rápido en vez de fallar en el primer request).
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(4000),

  // No se valida como URI estricta: las contraseñas de Supabase pueden tener
  // caracteres que un validador de URI rechaza aunque Postgres los acepte.
  DATABASE_URL: Joi.string()
    .pattern(/^postgres(ql)?:\/\//)
    .required(),
  DATABASE_SSL: Joi.boolean().default(true),
  DATABASE_SSL_CA: Joi.string().allow('').optional(),

  SUPABASE_URL: Joi.string()
    .uri({ scheme: ['https', 'http'] })
    .required(),
  SUPABASE_JWT_AUDIENCE: Joi.string().default('authenticated'),
  // Secret key (sb_secret_...) o la legacy service_role: invitar, banear y borrar usuarios.
  SUPABASE_SERVICE_ROLE_KEY: Joi.string().required(),

  // Base del frontend: los links de invitación vuelven a `<FRONTEND_URL>/reset-password`.
  FRONTEND_URL: Joi.string()
    .uri({ scheme: ['https', 'http'] })
    .required(),

  CORS_ORIGINS: Joi.string().required(),

  // --- Google OAuth (conexión de casillas) ---
  GOOGLE_CLIENT_ID: Joi.string().required(),
  GOOGLE_CLIENT_SECRET: Joi.string().required(),
  // Tiene que coincidir carácter por carácter con la registrada en Google Cloud.
  GOOGLE_OAUTH_REDIRECT_URI: Joi.string()
    .uri({ scheme: ['https', 'http'] })
    .required(),
  // 32 bytes en base64: clave AES-256-GCM para encriptar los refresh_token.
  // Si cambia, los tokens guardados quedan ilegibles y hay que reconectar las casillas.
  GOOGLE_TOKEN_ENCRYPTION_KEY: Joi.string()
    .required()
    .custom((value: string, helpers) =>
      Buffer.from(value, 'base64').length === 32 ? value : helpers.error('any.invalid'),
    )
    .messages({ 'any.invalid': '{{#label}} tiene que ser 32 bytes en base64' }),
  // Firma el `state` del flujo OAuth (que nadie pueda falsificar una conexión).
  OAUTH_STATE_SECRET: Joi.string().min(32).required(),

  // Job de envíos programados (cada minuto). Apagarlo en una instancia que no
  // deba enviar (ej. una copia local apuntando a la misma base).
  SCHEDULED_SENDER_ENABLED: Joi.boolean().default(true),

  // Cupo de destinatarios por casilla en 24 horas (Gmail común ~500; Workspace 2000).
  MAILBOX_DAILY_RECIPIENT_LIMIT: Joi.number().integer().min(1).default(500),
});
