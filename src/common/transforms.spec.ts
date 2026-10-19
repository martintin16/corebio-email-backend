import type { TransformFnParams } from 'class-transformer';
import { trimLowerString, trimString } from './transforms';

const params = (value: unknown) => ({ value }) as TransformFnParams;

describe('transforms', () => {
  it('trimString recorta strings y deja pasar el resto', () => {
    expect(trimString(params('  Hola  '))).toBe('Hola');
    expect(trimString(params(42))).toBe(42);
  });

  it('trimLowerString recorta y pasa a minúsculas', () => {
    expect(trimLowerString(params('  Tesoreria@Corebio.ORG '))).toBe('tesoreria@corebio.org');
    expect(trimLowerString(params(undefined))).toBeUndefined();
  });
});
