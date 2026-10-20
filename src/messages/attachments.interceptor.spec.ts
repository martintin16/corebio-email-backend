import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { translateMulterError } from './attachments.interceptor';

/** Cómo llegan los errores de multer después de que Nest los convierte. */
describe('translateMulterError', () => {
  it.each(['Too many files', 'Too many files - attachments'])(
    '"%s" → 400 "Máximo 10 adjuntos"',
    (message) => {
      const result = translateMulterError(new BadRequestException(message));
      expect(result).toBeInstanceOf(BadRequestException);
      expect(result.message).toBe('Máximo 10 adjuntos');
    },
  );

  it.each(['Unexpected field', 'Unexpected field - archivo', 'Unexpected file field - archivo'])(
    '"%s" → 400 con el campo correcto',
    (message) => {
      const result = translateMulterError(new BadRequestException(message));
      expect(result).toBeInstanceOf(BadRequestException);
      expect(result.message).toMatch(/campo "attachments"/);
    },
  );

  it.each(['File too large', 'File too large - attachments'])(
    '"%s" → 413 en español',
    (message) => {
      const result = translateMulterError(new PayloadTooLargeException(message));
      expect(result).toBeInstanceOf(PayloadTooLargeException);
      expect(result.message).toBe('Los adjuntos superan los 20 MB en total');
    },
  );

  it('cualquier otro 413 → mismo mensaje de tamaño', () => {
    const result = translateMulterError(new PayloadTooLargeException('Request entity too large'));
    expect(result.message).toBe('Los adjuntos superan los 20 MB en total');
  });

  it('el resto → 400 genérico en español', () => {
    const result = translateMulterError(new BadRequestException('Multipart: Boundary not found'));
    expect(result).toBeInstanceOf(BadRequestException);
    expect(result.message).toBe('No se pudo leer el formulario con los adjuntos');
  });
});
