import { INestApplication, ValidationPipe } from '@nestjs/common';

/**
 * Configuración global de la app que también tienen que usar los tests e2e,
 * para que validen exactamente lo mismo que producción.
 */
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
