/**
 * Clave para comparar nombres de plantilla: sin tildes, sin mayúsculas y con
 * los espacios normalizados. "Confirmación  de pago" y "confirmacion de PAGO"
 * dan lo mismo → no pueden convivir en la misma casilla.
 */
export function templateNameKey(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}
