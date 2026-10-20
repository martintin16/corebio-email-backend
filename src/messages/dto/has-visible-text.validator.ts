import { registerDecorator, type ValidationOptions } from 'class-validator';
import { htmlToPlainText } from '../content/html-content';

/**
 * El editor enriquecido manda HTML: un mensaje "vacío" sigue siendo `<p></p>`.
 * Igual que `composeSchema` del frontend, se valida contra el texto que se ve.
 */
export function HasVisibleText(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'hasVisibleText',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: 'El mensaje está vacío', ...options },
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && htmlToPlainText(value).length > 0,
      },
    });
  };
}
