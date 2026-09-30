import { QueryFailedError } from 'typeorm';

/** Códigos de error de Postgres que el backend traduce a respuestas HTTP. */
export const PG_UNIQUE_VIOLATION = '23505';

/** true si el error es una violación de UNIQUE (opcionalmente, de una constraint puntual). */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const driverError = err.driverError as { code?: string; constraint?: string } | undefined;
  if (driverError?.code !== PG_UNIQUE_VIOLATION) return false;
  return constraint === undefined || driverError.constraint === constraint;
}
