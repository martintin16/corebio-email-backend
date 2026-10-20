import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';

/** Los ids de Gmail son alfanuméricos (hex en la práctica). */
const GMAIL_ID = /^[A-Za-z0-9_-]{6,64}$/;

/** Valida `:messageId` / `:sentId` antes de mandarlos a Gmail. */
@Injectable()
export class ParseGmailIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!GMAIL_ID.test(value)) throw new BadRequestException('Id de mensaje inválido');
    return value;
  }
}
