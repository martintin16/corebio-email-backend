import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';

/** Los ids de Gmail son alfanuméricos (hex en la práctica). */
export const GMAIL_ID = /^[A-Za-z0-9_-]{6,64}$/;
/** Id de una etiqueta creada por el usuario (las de sistema son INBOX, UNREAD…). */
export const USER_LABEL_ID = /^Label_[A-Za-z0-9_-]{1,64}$/;
/** pageToken de Gmail (lo devuelve la página anterior; hoy son dígitos). */
export const PAGE_TOKEN = /^[A-Za-z0-9_.-]{1,256}$/;
/** Id de un adjunto: el `partId` de Gmail ("1", "0.2", "1.0.3"). */
export const ATTACHMENT_ID = /^\d{1,4}(\.\d{1,4}){0,5}$/;

/** Valida `:messageId` / `:sentId` antes de mandarlos a Gmail. */
@Injectable()
export class ParseGmailIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!GMAIL_ID.test(value)) throw new BadRequestException('Id de mensaje inválido');
    return value;
  }
}

/** Valida `:attachmentId`. */
@Injectable()
export class ParseAttachmentIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!ATTACHMENT_ID.test(value)) throw new BadRequestException('Id de adjunto inválido');
    return value;
  }
}
