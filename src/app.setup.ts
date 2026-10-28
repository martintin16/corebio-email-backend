import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';

/**
 * Tamaño máximo de un pedido JSON (plantillas, permisos, etc.). El de Express
 * por defecto es 100 KB, bastante menos que el cuerpo que aceptan los DTOs
 * (MAX_BODY_LENGTH, 1.000.000 de caracteres): una plantilla larga con formato
 * pegado de Word fallaba antes de llegar a la validación.
 */
export const JSON_BODY_LIMIT = '2mb';
export const BODY_TOO_LARGE = 'El contenido es demasiado grande (máximo 2 MB)';

/**
 * Configuración global de la app que también tienen que usar los tests e2e,
 * para que validen exactamente lo mismo que producción.
 */
export function configureApp(app: INestApplication): void {
  const expressApp = app as NestExpressApplication;
  expressApp.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  expressApp.useBodyParser('urlencoded', { limit: JSON_BODY_LIMIT, extended: true });
  // Va después de los parsers: así recibe su error de "demasiado grande" y
  // lo responde en castellano, con el mismo formato que el resto de los errores.
  expressApp.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (isTooLarge(err)) {
      res
        .status(413)
        .json({ statusCode: 413, message: BODY_TOO_LARGE, error: 'Payload Too Large' });
      return;
    }
    next(err);
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}

function isTooLarge(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  return (err as { type?: unknown }).type === 'entity.too.large';
}
