import { canonicalEmail, sameMailboxAddress } from './email-address';

describe('email-address', () => {
  it.each([
    ['Casilla.Prueba@gmail.com', 'casillaprueba@gmail.com'],
    ['casilla.prueba@googlemail.com', 'casillaprueba@gmail.com'],
    [' Tesoreria@Corebio.org ', 'tesoreria@corebio.org'],
    ['te.so.reria@corebio.org', 'te.so.reria@corebio.org'],
  ])('canonicalEmail(%p) = %p', (input, expected) => {
    expect(canonicalEmail(input)).toBe(expected);
  });

  it('en Gmail los puntos no cuentan', () => {
    expect(
      sameMailboxAddress('casilla.prueba.tesoreria@gmail.com', 'casillapruebatesoreria@gmail.com'),
    ).toBe(true);
  });

  it('en otros dominios los puntos sí cuentan', () => {
    expect(sameMailboxAddress('te.soreria@corebio.org', 'tesoreria@corebio.org')).toBe(false);
  });

  it('cuentas distintas no coinciden', () => {
    expect(sameMailboxAddress('a@gmail.com', 'b@gmail.com')).toBe(false);
  });
});
