import { BadRequestException, type ValidationError } from '@nestjs/common';
import { collectMessages, tooLong, validationExceptionFactory } from './validation-messages';

const error = (
  property: string,
  constraints?: Record<string, string>,
  children: ValidationError[] = [],
) => ({ property, constraints, children }) as ValidationError;

describe('validation-messages', () => {
  it('tooLong usa separador de miles de Argentina', () => {
    expect(tooLong('name', 1000)).toBe('name: máximo 1.000 caracteres');
  });

  it('traduce el campo de más y deja los demás mensajes como vienen', () => {
    const messages = collectMessages([
      error('foo', { whitelistValidation: 'property foo should not exist' }),
      error('subject', { isNotEmpty: 'subject no puede estar vacío' }),
    ]);
    expect(messages).toEqual(['foo no es un campo permitido', 'subject no puede estar vacío']);
  });

  it('incluye los errores anidados con su ruta', () => {
    const messages = collectMessages([
      error('forwardedAttachments', undefined, [
        error('0', undefined, [error('bar', { whitelistValidation: 'x' })]),
      ]),
    ]);
    expect(messages).toEqual(['forwardedAttachments.0.bar no es un campo permitido']);
  });

  it('devuelve un 400 con la lista de mensajes', () => {
    const exception = validationExceptionFactory([
      error('name', { isString: 'name tiene que ser texto' }),
    ]);
    expect(exception).toBeInstanceOf(BadRequestException);
    expect(exception.getResponse()).toMatchObject({
      statusCode: 400,
      message: ['name tiene que ser texto'],
    });
  });
});
