import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../auth.constants';

/**
 * Marca un endpoint (o un controller entero) como público: el JwtAuthGuard global
 * lo deja pasar sin token. Por defecto TODO endpoint requiere autenticación.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
