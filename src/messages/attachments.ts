import { PayloadTooLargeException } from '@nestjs/common';
import type { OutgoingAttachment } from './gmail/mime';

/** Límite de Gmail: 25 MB por mensaje, y la codificación base64 suma ~33%. */
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENTS_TOTAL_BYTES = 20 * 1024 * 1024;

/** Lo que multer deja en `@UploadedFiles()` (solo los campos que se usan). */
export interface UploadedAttachment {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Valida el total y convierte los archivos subidos al formato del armado MIME. */
export function toOutgoingAttachments(
  files: UploadedAttachment[] | undefined,
): OutgoingAttachment[] {
  const list = files ?? [];
  const total = list.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_ATTACHMENTS_TOTAL_BYTES) {
    throw new PayloadTooLargeException('Los adjuntos superan los 20 MB en total');
  }
  return list.map((f) => ({
    filename: f.originalname,
    contentType: f.mimetype || 'application/octet-stream',
    content: f.buffer,
  }));
}
