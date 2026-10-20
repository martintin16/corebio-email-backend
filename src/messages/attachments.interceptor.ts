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

/** Mensajes de multer (en inglés) → mensajes para mostrar en el frontend. */
const MULTER_MESSAGES: Record<string, () => HttpException> = {
  'File too large': () => new PayloadTooLargeException(ATTACHMENTS_TOO_LARGE),
  'Too many files': () => new BadRequestException(TOO_MANY_ATTACHMENTS),
  'Unexpected field': () =>
    new BadRequestException(
      `Los adjuntos van en el campo "attachments" (máximo ${MAX_ATTACHMENTS})`,
    ),
};

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
      const known = MULTER_MESSAGES[err.message];
      if (known) throw known();
      if (err.getStatus() === 413) throw new PayloadTooLargeException(ATTACHMENTS_TOO_LARGE);
      throw new BadRequestException('No se pudo leer el formulario con los adjuntos');
    }
  }
}
