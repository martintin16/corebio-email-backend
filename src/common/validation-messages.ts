import { BadRequestException, type ValidationError } from '@nestjs/common';

/**
 * Mensajes de validación en castellano (regla del proyecto: todo lo que puede
 * llegar a verse en el front, en castellano). class-validator los trae en
 * inglés si el decorador no lleva `message`.
 */
export const notText = (field: string) => `${field} tiene que ser texto`;
export const tooLong = (field: string, max: number) =>
  `${field}: máximo ${max.toLocaleString('es-AR')} caracteres`;
export const tooMany = (field: string, max: number) => `${field}: máximo ${max} elementos`;

/** El cuerpo de un mail o una plantilla (MAX_BODY_LENGTH). */
export const BODY_TOO_LONG = 'El texto es demasiado largo (máximo 1.000.000 de caracteres)';

/**
 * Errores del ValidationPipe → 400 con la lista de mensajes (mismo formato que
 * el de Nest). Lo único que traduce es el campo de más (`forbidNonWhitelisted`),
 * que Nest arma en inglés ("property x should not exist"); el resto ya viene
 * en castellano desde los DTOs.
 */
export function validationExceptionFactory(errors: ValidationError[]): BadRequestException {
  return new BadRequestException(collectMessages(errors));
}

export function collectMessages(errors: ValidationError[], parent = ''): string[] {
  const messages: string[] = [];
  for (const error of errors) {
    const path = parent ? `${parent}.${error.property}` : error.property;
    for (const [constraint, message] of Object.entries(error.constraints ?? {})) {
      messages.push(
        constraint === 'whitelistValidation' ? `${path} no es un campo permitido` : message,
      );
    }
    if (error.children?.length) messages.push(...collectMessages(error.children, path));
  }
  return messages;
}
