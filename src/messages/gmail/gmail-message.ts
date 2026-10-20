import type { gmail_v1 } from 'googleapis';

type GmailMessage = gmail_v1.Schema$Message;
type GmailPart = gmail_v1.Schema$MessagePart;

/** Valor de un encabezado del mensaje (sin distinguir mayúsculas), decodificado. '' si no está. */
export function getHeader(message: GmailMessage | undefined, name: string): string {
  return getPartHeader(message?.payload ?? undefined, name);
}

/** Igual que getHeader, pero de una parte MIME. */
export function getPartHeader(part: GmailPart | undefined, name: string): string {
  const found = part?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return decodeMimeWords(found?.value ?? '').trim();
}

/**
 * Decodifica "encoded words" de RFC 2047 (`=?UTF-8?B?...?=` / `=?UTF-8?Q?...?=`),
 * que pueden aparecer en asuntos y nombres con tildes. Si no hay, devuelve igual.
 */
export function decodeMimeWords(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, '?==?') // palabras codificadas contiguas van pegadas
    .replace(
      /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g,
      (whole, charset: string, enc: string, text: string) => {
        try {
          const bytes =
            enc.toUpperCase() === 'B'
              ? Buffer.from(text, 'base64')
              : Buffer.from(
                  text
                    .replace(/_/g, ' ')
                    .replace(/=([0-9a-f]{2})/gi, (_m, hex: string) =>
                      String.fromCharCode(parseInt(hex, 16)),
                    ),
                  'binary',
                );
          return decodeBytes(bytes, charset);
        } catch {
          return whole;
        }
      },
    );
}

/** Una dirección de `From`: `"Ana Pérez" <ana@x.com>`, `ana@x.com`, `Ana <ana@x.com>, otro@y.com`. */
export function parseAddress(value: string): { name: string; email: string } {
  const first = splitAddresses(value)[0] ?? '';
  const angle = /^(.*)<([^>]+)>\s*$/.exec(first);
  if (angle) {
    const name = angle[1]
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .replace(/\\"/g, '"')
      .trim();
    const email = angle[2].trim();
    return { name: name || email, email };
  }
  const email = first.trim();
  return { name: email, email };
}

/** Separa una lista de direcciones por comas, respetando comas dentro de comillas. */
function splitAddresses(value: string): string[] {
  const result: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of value) {
    if (char === '"') quoted = !quoted;
    if (char === ',' && !quoted) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) result.push(current);
  return result.map((a) => a.trim()).filter((a) => a.length > 0);
}

/** Cuerpos del mensaje: la primera parte text/html y la primera text/plain (sin adjuntos). */
export function extractBodies(payload: GmailPart | undefined): {
  html: string | null;
  text: string | null;
} {
  let html: string | null = null;
  let text: string | null = null;

  const walk = (part: GmailPart | undefined): void => {
    if (!part) return;
    const isAttachment =
      Boolean(part.filename) || /attachment/i.test(getPartHeader(part, 'Content-Disposition'));
    const mime = (part.mimeType ?? '').toLowerCase();
    if (!isAttachment && part.body?.data) {
      if (mime === 'text/html' && html === null) html = decodePart(part);
      if (mime === 'text/plain' && text === null) text = decodePart(part);
    }
    part.parts?.forEach(walk);
  };
  walk(payload);
  return { html, text };
}

function decodePart(part: GmailPart): string {
  const charset =
    /charset="?([^";\s]+)"?/i.exec(getPartHeader(part, 'Content-Type'))?.[1] ?? 'utf-8';
  return decodeBytes(Buffer.from(part.body?.data ?? '', 'base64url'), charset);
}

function decodeBytes(bytes: Buffer, charset: string): string {
  try {
    return new TextDecoder(charset.toLowerCase()).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Gmail devuelve `snippet` con entidades HTML (`&#39;`, `&amp;`): se pasan a texto. */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1].toLowerCase() === 'x'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

/** Fecha del mensaje en ISO: `internalDate` de Gmail (ms), o el encabezado Date. */
export function messageDateIso(message: GmailMessage): string {
  const internal = Number(message.internalDate);
  if (Number.isFinite(internal) && internal > 0) return new Date(internal).toISOString();
  const header = Date.parse(getHeader(message, 'Date'));
  return new Date(Number.isNaN(header) ? 0 : header).toISOString();
}

/** Asunto de una respuesta: agrega "Re: " si no lo tiene ya. */
export function replySubject(subject: string): string {
  const trimmed = subject.trim();
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

export function hasLabel(message: GmailMessage, label: string): boolean {
  return (message.labelIds ?? []).includes(label);
}

/** Un adjunto dentro de un mensaje de Gmail (lo necesario para listarlo y bajarlo). */
export interface AttachmentPart {
  /** `partId` de Gmail ("1", "0.2"): estable entre lecturas, a diferencia de `attachmentId`. */
  partId: string;
  filename: string;
  mimeType: string;
  /** Tamaño ya decodificado, en bytes. */
  size: number;
  /** Si está, el contenido se pide aparte con `messages.attachments.get`. */
  attachmentId: string | null;
  /** Si no hay `attachmentId`, Gmail manda el contenido acá (base64url). */
  data: string | null;
}

/**
 * Las partes con nombre de archivo (adjuntos e imágenes embebidas). Un adjunto
 * que es a su vez un mail (`message/rfc822`) cuenta como uno solo: no se
 * recorren sus partes internas.
 */
export function listAttachmentParts(payload: GmailPart | undefined): AttachmentPart[] {
  const result: AttachmentPart[] = [];
  const walk = (part: GmailPart | undefined): void => {
    if (!part) return;
    const filename = decodeMimeWords(part.filename ?? '').trim();
    if (filename && part.partId) {
      result.push({
        partId: part.partId,
        filename,
        mimeType: (part.mimeType || 'application/octet-stream').toLowerCase(),
        size: part.body?.size ?? 0,
        attachmentId: part.body?.attachmentId ?? null,
        data: part.body?.data ?? null,
      });
      return;
    }
    part.parts?.forEach(walk);
  };
  walk(payload);
  return result;
}
