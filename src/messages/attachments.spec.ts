import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import {
  assertAttachmentLimits,
  contentDisposition,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENTS_TOTAL_BYTES,
  toDownload,
  toOutgoingAttachments,
} from './attachments';
import { mapWithConcurrency } from '../common/concurrency';

const file = (name: string, size: number) => ({
  originalname: name,
  mimetype: '',
  size,
  buffer: Buffer.alloc(1),
});

describe('toOutgoingAttachments', () => {
  it('sin archivos devuelve []', () => {
    expect(toOutgoingAttachments(undefined)).toEqual([]);
  });

  it('convierte y completa el tipo si falta', () => {
    expect(toOutgoingAttachments([file('a.pdf', 10)])).toEqual([
      { filename: 'a.pdf', contentType: 'application/octet-stream', content: Buffer.alloc(1) },
    ]);
  });

  it('413 si el total supera el límite', () => {
    expect(() =>
      toOutgoingAttachments([
        file('a', MAX_ATTACHMENTS_TOTAL_BYTES / 2),
        file('b', MAX_ATTACHMENTS_TOTAL_BYTES / 2 + 1),
      ]),
    ).toThrow(PayloadTooLargeException);
  });
});

describe('mapWithConcurrency', () => {
  it('respeta el orden y el límite de concurrencia', async () => {
    let running = 0;
    let maxRunning = 0;
    const result = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return n * 10;
    });
    expect(result).toEqual([10, 20, 30, 40, 50, 60]);
    expect(maxRunning).toBe(2);
  });
});

describe('assertAttachmentLimits', () => {
  it('acepta hasta el máximo', () => {
    expect(() =>
      assertAttachmentLimits(MAX_ATTACHMENTS, MAX_ATTACHMENTS_TOTAL_BYTES),
    ).not.toThrow();
  });

  it('400 en español con adjuntos de más', () => {
    expect(() => assertAttachmentLimits(MAX_ATTACHMENTS + 1, 0)).toThrow(
      new BadRequestException('Máximo 10 adjuntos'),
    );
  });

  it('413 en español si el total supera 20 MB', () => {
    expect(() => assertAttachmentLimits(1, MAX_ATTACHMENTS_TOTAL_BYTES + 1)).toThrow(
      PayloadTooLargeException,
    );
  });
});

describe('contentDisposition', () => {
  it('nombre ASCII de respaldo + filename* en UTF-8', () => {
    expect(contentDisposition('Información año.pdf')).toBe(
      `attachment; filename="Informacion ano.pdf"; filename*=UTF-8''Informaci%C3%B3n%20a%C3%B1o.pdf`,
    );
  });

  it('no deja pasar comillas ni saltos de línea al encabezado', () => {
    const value = contentDisposition('a"b\r\nSet-Cookie: x.txt');
    expect(value).not.toMatch(/[\r\n]/);
    expect(value).toContain('filename="a_b__Set-Cookie: x.txt"');
  });

  it('nombre vacío → "adjunto"', () => {
    expect(contentDisposition('')).toContain('filename="adjunto"');
  });
});

describe('toDownload', () => {
  it('arma el archivo con tipo, largo y disposición', () => {
    const file = toDownload({
      filename: 'a.txt',
      mimeType: 'text/plain',
      content: Buffer.from('hola'),
    });
    expect(file.options).toEqual(expect.objectContaining({ type: 'text/plain', length: 4 }));
    expect(file.options.disposition).toContain('filename="a.txt"');
  });
});
