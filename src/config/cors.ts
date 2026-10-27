import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

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

/**
 * Opciones de CORS de la API.
 * - `credentials: false`: la auth va por header Authorization (Bearer), no por cookies.
 * - `exposedHeaders`: el front descarga los adjuntos desde el navegador, en otro
 *   origen (Vercel → Railway, o :3000 → :4000 en local). Sin esto el navegador le
 *   oculta `Content-Disposition` y el archivo se guarda como "adjunto" en vez de con
 *   su nombre.
 */
export function corsOptions(rawOrigins: string | undefined): CorsOptions {
  return {
    origin: parseCorsOrigins(rawOrigins),
    credentials: false,
    exposedHeaders: ['Content-Disposition'],
  };
}
