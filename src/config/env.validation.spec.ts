import { envValidationSchema } from './env.validation';

const valid = {
  DATABASE_URL: 'postgresql://postgres:p@ss#word@db.ref.supabase.co:5432/postgres',
  SUPABASE_URL: 'https://ref.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test',
  FRONTEND_URL: 'http://localhost:3000',
  CORS_ORIGINS: 'http://localhost:3000',
  GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'secret',
  GOOGLE_OAUTH_REDIRECT_URI: 'http://localhost:4000/mailboxes/oauth/callback',
  GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  OAUTH_STATE_SECRET: 'x'.repeat(32),
};

describe('envValidationSchema', () => {
  it('acepta la config mínima y completa los defaults', () => {
    const { error, value } = envValidationSchema.validate(valid);
    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4000,
      DATABASE_SSL: true,
      SUPABASE_JWT_AUDIENCE: 'authenticated',
    });
  });

  it.each([
    'DATABASE_URL',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'FRONTEND_URL',
    'CORS_ORIGINS',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_OAUTH_REDIRECT_URI',
    'GOOGLE_TOKEN_ENCRYPTION_KEY',
    'OAUTH_STATE_SECRET',
  ])('exige %s', (key) => {
    const env: Record<string, string> = { ...valid };
    delete env[key];
    expect(envValidationSchema.validate(env).error).toBeDefined();
  });

  it('rechaza una clave de encriptación que no es de 32 bytes', () => {
    const { error } = envValidationSchema.validate({
      ...valid,
      GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64'),
    });
    expect(error?.message).toContain('32 bytes');
  });

  it('rechaza un OAUTH_STATE_SECRET corto', () => {
    const { error } = envValidationSchema.validate({ ...valid, OAUTH_STATE_SECRET: 'corto' });
    expect(error).toBeDefined();
  });

  it('rechaza una DATABASE_URL que no es de Postgres', () => {
    const { error } = envValidationSchema.validate({ ...valid, DATABASE_URL: 'mysql://x' });
    expect(error).toBeDefined();
  });
});
