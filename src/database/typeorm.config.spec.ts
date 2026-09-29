import { buildDataSourceOptions } from './typeorm.config';

const url = 'postgresql://postgres:x@db.ref.supabase.co:5432/postgres';

describe('buildDataSourceOptions', () => {
  it('nunca sincroniza el schema automáticamente', () => {
    const options = buildDataSourceOptions({ url, ssl: true });
    expect(options.synchronize).toBe(false);
    expect(options.migrationsRun).toBe(false);
  });

  it('sin CA usa SSL sin verificar el certificado', () => {
    expect(buildDataSourceOptions({ url, ssl: true }).ssl).toEqual({ rejectUnauthorized: false });
    expect(buildDataSourceOptions({ url, ssl: true, sslCa: '  ' }).ssl).toEqual({
      rejectUnauthorized: false,
    });
  });

  it('con CA verifica el certificado y normaliza los \\n literales', () => {
    const options = buildDataSourceOptions({ url, ssl: true, sslCa: 'LINEA1\\nLINEA2' });
    expect(options.ssl).toEqual({ ca: 'LINEA1\nLINEA2', rejectUnauthorized: true });
  });

  it('permite apagar SSL (ej. un Postgres local)', () => {
    expect(buildDataSourceOptions({ url, ssl: false }).ssl).toBe(false);
  });
});
