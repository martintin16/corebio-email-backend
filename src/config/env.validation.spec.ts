import { envValidationSchema } from './env.validation';

const valid = {
  DATABASE_URL: 'postgresql://postgres:p@ss#word@db.ref.supabase.co:5432/postgres',
  SUPABASE_URL: 'https://ref.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test',
  FRONTEND_URL: 'http://localhost:3000',
  CORS_ORIGINS: 'http://localhost:3000',
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
  ])('exige %s', (key) => {
    const env: Record<string, string> = { ...valid };
    delete env[key];
    expect(envValidationSchema.validate(env).error).toBeDefined();
  });

  it('rechaza una DATABASE_URL que no es de Postgres', () => {
    const { error } = envValidationSchema.validate({ ...valid, DATABASE_URL: 'mysql://x' });
    expect(error).toBeDefined();
  });
});
