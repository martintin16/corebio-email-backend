import type { Request } from 'express';
import type { AppRole } from '../../users/users.types';

/** Usuario autenticado, con la misma forma que `CurrentUser` del frontend. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: AppRole;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}
