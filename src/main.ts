import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { parseCorsOrigins } from './config/cors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.use(helmet());
  app.enableCors({
    origin: parseCorsOrigins(config.get<string>('CORS_ORIGINS')),
    // Auth va por header Authorization (Bearer), no por cookies.
    credentials: false,
  });
  configureApp(app);
  app.enableShutdownHooks();

  const port = Number(config.get('PORT') ?? 4000);
  await app.listen(port, '0.0.0.0');
  Logger.log(`Corebio Mail API escuchando en el puerto ${port}`, 'Bootstrap');
}

void bootstrap();
