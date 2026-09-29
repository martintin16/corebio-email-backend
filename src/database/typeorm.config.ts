import { join } from 'path';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

export interface DatabaseEnv {
  url: string;
  ssl: boolean;
  sslCa?: string;
}

/**
 * Extensión de los archivos que TypeORM tiene que cargar por glob:
 * `.ts` cuando corre con ts-node (CLI de migraciones en local), `.js` en dist.
 * Evita que el glob levante archivos que no corresponden al entorno actual.
 */
export const SOURCE_EXT = __filename.endsWith('.ts') ? 'ts' : 'js';

function buildSsl(env: DatabaseEnv): PostgresConnectionOptions['ssl'] {
  if (!env.ssl) return false;
  if (env.sslCa && env.sslCa.trim().length > 0) {
    // Railway/.env pueden guardar el PEM con "\n" literales en vez de saltos reales.
    return { ca: env.sslCa.replace(/\\n/g, '\n'), rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}

/**
 * Opciones de conexión compartidas entre la app (Nest) y el CLI de migraciones.
 * `synchronize` está siempre apagado: el schema solo cambia con migraciones
 * versionadas, porque esta base es compartida con el schema `auth` de Supabase.
 */
export function buildDataSourceOptions(env: DatabaseEnv): PostgresConnectionOptions {
  return {
    type: 'postgres',
    url: env.url,
    ssl: buildSsl(env),
    synchronize: false,
    migrationsRun: false,
    migrationsTableName: 'typeorm_migrations',
    migrations: [join(__dirname, 'migrations', `*.${SOURCE_EXT}`)],
  };
}
