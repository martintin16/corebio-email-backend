import { SetMetadata } from '@nestjs/common';
import type { AppRole } from '../../users/users.types';
import { ROLES_KEY } from '../auth.constants';

/** Restringe un endpoint (o controller) a los roles indicados. Ej: `@Roles('admin')`. */
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);
