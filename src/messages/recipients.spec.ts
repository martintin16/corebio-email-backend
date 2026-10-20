import { BadRequestException } from '@nestjs/common';
import {
  joinRecipients,
  MAX_RECIPIENTS,
  parseRecipientField,
  recipientCount,
  resolveRecipients,
} from './recipients';

describe('parseRecipientField', () => {
  it('separa por coma o punto y coma, acepta Nombre <email> y respeta comas entre comillas', () => {
    expect(
      parseRecipientField(' ana@x.com,beto@y.com ; "Pérez, Carla" <carla@z.com>, <d@w.com> '),
    ).toEqual({ emails: ['ana@x.com', 'beto@y.com', 'carla@z.com', 'd@w.com'], invalid: [] });
  });

  it('vacío, null o solo separadores → sin direcciones', () => {
    expect(parseRecipientField('')).toEqual({ emails: [], invalid: [] });
    expect(parseRecipientField(undefined)).toEqual({ emails: [], invalid: [] });
    expect(parseRecipientField(' , ; ')).toEqual({ emails: [], invalid: [] });
  });

  it('separa las inválidas', () => {
    expect(parseRecipientField('ana@x.com, no-es-email')).toEqual({
      emails: ['ana@x.com'],
      invalid: ['no-es-email'],
    });
  });
});

describe('resolveRecipients', () => {
  it('saca repetidos sin distinguir mayúsculas y deja cada uno en el campo más visible', () => {
    const r = resolveRecipients({
      to: 'ana@x.com, ANA@x.com',
      cc: 'Ana@X.com, beto@y.com',
      bcc: 'beto@Y.com, carla@z.com',
    });
    expect(r).toEqual({ to: ['ana@x.com'], cc: ['beto@y.com'], bcc: ['carla@z.com'] });
    expect(recipientCount(r)).toBe(3);
    expect(joinRecipients(r.to)).toBe('ana@x.com');
  });

  it('alcanza con uno en cualquier campo', () => {
    expect(resolveRecipients({ to: '', bcc: 'a@x.com' }).bcc).toEqual(['a@x.com']);
  });

  it('400 si no hay ninguno', () => {
    expect(() => resolveRecipients({ to: '', cc: ' ', bcc: undefined })).toThrow(
      new BadRequestException('Ingresá al menos un destinatario'),
    );
  });

  it(`400 con más de ${MAX_RECIPIENTS}`, () => {
    const many = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `u${i}@x.com`).join(',');
    expect(() => resolveRecipients({ to: many })).toThrow(BadRequestException);
  });
});
