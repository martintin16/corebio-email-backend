import { BadRequestException, PayloadTooLargeException, StreamableFile } from '@nestjs/common';
import type { OutgoingAttachment } from './gmail/mime';
import type { DownloadedAttachment } from './messages.types';

/** Límite de Gmail: 25 MB por mensaje, y la codificación base64 suma ~33%. */
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENTS_TOTAL_BYTES = 20 * 1024 * 1024;

export const TOO_MANY_ATTACHMENTS = `Máximo ${MAX_ATTACHMENTS} adjuntos`;
export const ATTACHMENTS_TOO_LARGE = 'Los adjuntos superan los 20 MB en total';

/** Lo que multer deja en `@UploadedFiles()` (solo los campos que se usan). */
export interface UploadedAttachment {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Límites de un mensaje, contando todos los adjuntos juntos (subidos, reenviados
 * y los que se conservan al editar un programado).
 */
export function assertAttachmentLimits(count: number, totalBytes: number): void {
  if (count > MAX_ATTACHMENTS) throw new BadRequestException(TOO_MANY_ATTACHMENTS);
  if (totalBytes > MAX_ATTACHMENTS_TOTAL_BYTES) {
    throw new PayloadTooLargeException(ATTACHMENTS_TOO_LARGE);
  }
}

/** Valida el total y convierte los archivos subidos al formato del armado MIME. */
export function toOutgoingAttachments(
  files: UploadedAttachment[] | undefined,
): OutgoingAttachment[] {
  const list = files ?? [];
  assertAttachmentLimits(
    list.length,
    list.reduce((sum, f) => sum + f.size, 0),
  );
  return list.map((f) => ({
    filename: f.originalname,
    contentType: f.mimetype || 'application/octet-stream',
    content: f.buffer,
  }));
}

/**
 * `Content-Disposition: attachment` con el nombre original: `filename*` (UTF-8,
 * RFC 5987) para tildes y un `filename` ASCII de respaldo. Nunca deja pasar
 * comillas ni saltos de línea al encabezado.
 */
export function contentDisposition(filename: string): string {
  const fallback =
    filename
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7e]|["\\]/g, '_')
      .trim() || 'adjunto';
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** Respuesta de descarga: siempre como archivo adjunto, nunca para mostrar en el navegador. */
export function toDownload(file: DownloadedAttachment): StreamableFile {
  return new StreamableFile(file.content, {
    type: file.mimeType || 'application/octet-stream',
    disposition: contentDisposition(file.filename),
    length: file.content.length,
  });
}
