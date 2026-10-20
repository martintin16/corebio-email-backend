import { BadRequestException } from '@nestjs/common';
import { isEmail } from 'class-validator';
import { parseAddress } from './gmail/gmail-message';

/** Tope de destinatarios por campo y por mensaje (el cupo diario igual manda). */
export const MAX_RECIPIENTS = 500;

/** Destinatarios de un mensaje ya separados, validados y sin repetidos. */
export interface Recipients {
  to: string[];
  cc: string[];
  bcc: string[];
}

/**
 * Parte un campo de destinatarios (`"a@x.com, b@y.com"`, el formato del header
 * de Gmail). Acepta coma o punto y coma y también `Nombre <email>`; respeta
 * comas dentro de comillas. Devuelve las direcciones (solo el email) y las que
 * no son válidas.
 */
export function parseRecipientField(value: string | null | undefined): {
  emails: string[];
  invalid: string[];
} {
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const part of splitRecipients(value ?? '')) {
    const email = parseAddress(part).email.replace(/^<|>$/g, '').trim();
    if (isEmail(email)) emails.push(email);
    else invalid.push(part);
  }
  return { emails, invalid };
}

function splitRecipients(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  let angled = false;
  for (const char of value) {
    if (char === '"') quoted = !quoted;
    else if (char === '<' && !quoted) angled = true;
    else if (char === '>' && !quoted) angled = false;
    if ((char === ',' || char === ';') && !quoted && !angled) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * Arma los destinatarios de un envío: sin repetidos (sin distinguir mayúsculas)
 * y, si una dirección está en dos campos, queda en el más visible (to > cc > bcc)
 * para que nadie lo reciba dos veces. 400 si no queda ninguno o si son demasiados.
 */
export function resolveRecipients(fields: {
  to?: string | null;
  cc?: string | null;
  bcc?: string | null;
}): Recipients {
  const seen = new Set<string>();
  const pick = (value: string | null | undefined): string[] => {
    const result: string[] = [];
    for (const email of parseRecipientField(value).emails) {
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(email);
    }
    return result;
  };
  const recipients = { to: pick(fields.to), cc: pick(fields.cc), bcc: pick(fields.bcc) };
  const total = recipientCount(recipients);
  if (total === 0) throw new BadRequestException('Ingresá al menos un destinatario');
  if (total > MAX_RECIPIENTS) {
    throw new BadRequestException(`Máximo ${MAX_RECIPIENTS} destinatarios por mensaje`);
  }
  return recipients;
}

export function recipientCount(r: Recipients): number {
  return r.to.length + r.cc.length + r.bcc.length;
}

/** Para guardar o mostrar: `"a@x.com, b@y.com"` ('' si no hay). */
export function joinRecipients(emails: string[]): string {
  return emails.join(', ');
}
