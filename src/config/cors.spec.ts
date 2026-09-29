import { parseCorsOrigins } from './cors';

describe('parseCorsOrigins', () => {
  it('devuelve [] si no hay valor', () => {
    expect(parseCorsOrigins(undefined)).toEqual([]);
    expect(parseCorsOrigins('')).toEqual([]);
  });

  it('separa por coma, recorta espacios y saca la barra final', () => {
    expect(
      parseCorsOrigins('http://localhost:3000, https://corebio-email-collection.vercel.app/ ,,'),
    ).toEqual(['http://localhost:3000', 'https://corebio-email-collection.vercel.app']);
  });
});
