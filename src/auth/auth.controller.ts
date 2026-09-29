import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthenticatedUser } from './types/authenticated-user';

@Controller()
export class AuthController {
  /**
   * Devuelve el usuario autenticado (`{ id, email, role }`, igual a `CurrentUser`
   * del frontend). Sirve para probar de punta a punta que el token y el perfil andan.
   */
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}
