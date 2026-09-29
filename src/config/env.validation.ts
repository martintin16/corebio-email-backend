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

  CORS_ORIGINS: Joi.string().required(),
});
