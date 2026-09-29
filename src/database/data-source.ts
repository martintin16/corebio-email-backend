import 'dotenv/config';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions, SOURCE_EXT } from './typeorm.config';

/**
 * DataSource que usa el CLI de TypeORM para correr migraciones
 * (`npm run migration:run` en local, `npm run migration:run:prod` en Railway).
 * La app Nest no usa este archivo: arma su conexión en AppModule.
 */
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL no está definida (revisá tu .env)');
}

export default new DataSource({
  ...buildDataSourceOptions({
    url,
    ssl: process.env.DATABASE_SSL !== 'false',
    sslCa: process.env.DATABASE_SSL_CA,
  }),
  entities: [join(__dirname, '..', '**', `*.entity.${SOURCE_EXT}`)],
});
