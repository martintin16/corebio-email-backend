import { QueryFailedError } from 'typeorm';
import { isUniqueViolation } from './postgres-errors';

function pgError(code: string, constraint?: string): QueryFailedError {
  return new QueryFailedError(
    'INSERT ...',
    [],
    Object.assign(new Error('pg'), { code, constraint }),
  );
}

describe('isUniqueViolation', () => {
  it('detecta 23505', () => {
    expect(isUniqueViolation(pgError('23505', 'x_key'))).toBe(true);
  });

  it('filtra por constraint si se pide', () => {
    expect(isUniqueViolation(pgError('23505', 'x_key'), 'x_key')).toBe(true);
    expect(isUniqueViolation(pgError('23505', 'y_key'), 'x_key')).toBe(false);
  });

  it('ignora otros códigos y errores que no son de la base', () => {
    expect(isUniqueViolation(pgError('23503'))).toBe(false);
    expect(isUniqueViolation(new Error('otro'))).toBe(false);
  });
});
