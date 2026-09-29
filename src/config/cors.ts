/**
 * Convierte la lista de orígenes de CORS_ORIGINS ("a,b,c") en un array limpio.
 * Normaliza la barra final: el header Origin del navegador nunca la trae, así que
 * "https://app.vercel.app/" en la config no matchearía sin este paso.
 */
export function parseCorsOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin.length > 0);
}
