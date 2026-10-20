import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailboxesModule } from '../mailboxes/mailboxes.module';
import { Template } from './entities/template.entity';
import { MailboxTemplatesController, TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

/**
 * Fase 6 — Plantillas por casilla (nombre, asunto opcional y cuerpo HTML). Las
 * usa y gestiona cualquiera con canSend en la casilla. Se crean en la app: la
 * Gmail API no da acceso a las plantillas de Gmail.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Template]), MailboxesModule],
  controllers: [MailboxTemplatesController, TemplatesController],
  providers: [TemplatesService],
})
export class TemplatesModule {}
