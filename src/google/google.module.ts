import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Mailbox } from '../mailboxes/entities/mailbox.entity';
import { DefaultGoogleMailboxClient, GoogleMailboxClient } from './google-mailbox-client';
import { GoogleApisOAuthClient, GoogleOAuthClient } from './google-oauth.client';
import { OAuthStateService } from './oauth-state.service';
import { TokenCipher } from './token-cipher';

/**
 * Infraestructura de Google (como `auth/`, no es una entidad de negocio):
 * OAuth, encriptación de tokens y `GoogleMailboxClient`, el único punto de acceso
 * a Gmail/Drive para el resto de los módulos.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Mailbox])],
  providers: [
    TokenCipher,
    OAuthStateService,
    { provide: GoogleOAuthClient, useClass: GoogleApisOAuthClient },
    { provide: GoogleMailboxClient, useClass: DefaultGoogleMailboxClient },
  ],
  exports: [TokenCipher, OAuthStateService, GoogleOAuthClient, GoogleMailboxClient],
})
export class GoogleModule {}
