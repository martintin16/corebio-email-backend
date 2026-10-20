import type { TransformFnParams } from 'class-transformer';
import { IsString } from 'class-validator';
import { toArrayField, trimLowerString, trimString } from './transforms';

class Item {
  @IsString()
  id: string;
}

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

describe('toArrayField', () => {
  const objects = toArrayField(Item);
  const strings = toArrayField();

  it('parsea JSON que llega como texto (multipart) y crea instancias', () => {
    const result = objects(params('[{"id":"a"},{"id":"b"}]')) as Item[];
    expect(result).toHaveLength(2);
    expect(result[0]).toBeInstanceOf(Item);
    expect(result[1].id).toBe('b');
  });

  it('acepta arrays que ya vienen armados (JSON o multer con índices)', () => {
    const result = objects(params([{ id: 'a' }])) as Item[];
    expect(result[0]).toBeInstanceOf(Item);
  });

  it('JSON inválido u otra cosa se devuelve igual (lo rechaza @IsArray)', () => {
    expect(objects(params('[no es json'))).toBe('[no es json');
    expect(objects(params('suelto'))).toBe('suelto');
    expect(objects(params({ id: 'a' }))).toEqual({ id: 'a' });
  });

  it('listas de strings: un valor suelto cuenta como lista de uno', () => {
    expect(strings(params('1'))).toEqual(['1']);
    expect(strings(params('["1","2"]'))).toEqual(['1', '2']);
    expect(strings(params(['1', '2']))).toEqual(['1', '2']);
    expect(strings(params(''))).toEqual([]);
  });
});
