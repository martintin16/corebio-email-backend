import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  type NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Observable } from 'rxjs';
import {
  ATTACHMENTS_TOO_LARGE,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENTS_TOTAL_BYTES,
  TOO_MANY_ATTACHMENTS,
} from './attachments';

const MulterFilesInterceptor = FilesInterceptor('attachments', MAX_ATTACHMENTS, {
  limits: { fileSize: MAX_ATTACHMENTS_TOTAL_BYTES, files: MAX_ATTACHMENTS },
});

/**
 * Mensajes de multer (en inglés) → mensajes para mostrar en el frontend. Se
 * compara el comienzo: Nest 11.2+ agrega " - <campo>" al final, y las versiones
 * nuevas de multer dicen "Unexpected file field". El código de error
 * (LIMIT_UNEXPECTED_FILE, etc.) no sirve: Nest ya lo convirtió en su excepción.
 */
const MULTER_MESSAGES: [RegExp, () => HttpException][] = [
  [/^File too large/i, () => new PayloadTooLargeException(ATTACHMENTS_TOO_LARGE)],
  [/^Too many files/i, () => new BadRequestException(TOO_MANY_ATTACHMENTS)],
  [
    /^Unexpected (file )?field/i,
    () =>
      new BadRequestException(
        `Los adjuntos van en el campo "attachments" (máximo ${MAX_ATTACHMENTS})`,
      ),
  ],
];

/** Traduce un error de multer (ya convertido por Nest) al mensaje en español. */
export function translateMulterError(err: HttpException): HttpException {
  const known = MULTER_MESSAGES.find(([pattern]) => pattern.test(err.message));
  if (known) return known[1]();
  if (err.getStatus() === 413) return new PayloadTooLargeException(ATTACHMENTS_TOO_LARGE);
  return new BadRequestException('No se pudo leer el formulario con los adjuntos');
}

/**
 * Adjuntos: multipart/form-data con los archivos en el campo `attachments`
 * (máximo 10, 20 MB en total). También acepta JSON sin adjuntos.
 *
 * Envuelve el FilesInterceptor de Nest solo para traducir sus errores: todo lo
 * que falla adentro de su `intercept` es multer leyendo el formulario (el
 * handler corre recién después, en el Observable que devuelve).
 */
@Injectable()
export class AttachmentsInterceptor implements NestInterceptor {
  private readonly inner: NestInterceptor = new MulterFilesInterceptor();

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    try {
      return (await this.inner.intercept(context, next)) as Observable<unknown>;
    } catch (err) {
      if (!(err instanceof HttpException)) throw err;
      throw translateMulterError(err);
    }
  }
}
