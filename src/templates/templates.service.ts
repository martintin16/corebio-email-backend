import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isUniqueViolation } from '../common/postgres-errors';
import { MailboxAccessService } from '../mailboxes/mailbox-access.service';
import { htmlToPlainText, sanitizeEmailHtml, toSnippet } from '../messages/content/html-content';
import type { CreateTemplateDto } from './dto/create-template.dto';
import type { UpdateTemplateDto } from './dto/update-template.dto';
import { Template } from './entities/template.entity';
import type { MessageTemplate } from './templates.types';

/** Máximo de plantillas por casilla. */
export const MAX_TEMPLATES_PER_MAILBOX = 100;
/** Largo del `preview`. */
export const PREVIEW_LENGTH = 80;

const NOT_FOUND = 'La plantilla no existe';
const DUPLICATE_NAME = 'Ya existe una plantilla con ese nombre en esta casilla';
const UNIQUE_NAME_INDEX = 'templates_mailbox_name_key';

/**
 * Plantillas por casilla. Las usa y las gestiona cualquiera con canSend en la
 * casilla (el selector está en Redactar). En `/mailboxes/:mailboxId/...` lo
 * chequea `@RequireMailboxAccess('send')`; en `/templates/:id`, este servicio
 * (404 si no tiene canSend: no se revela que la plantilla existe).
 */
@Injectable()
export class TemplatesService {
  constructor(
    @InjectRepository(Template) private readonly repo: Repository<Template>,
    private readonly access: MailboxAccessService,
  ) {}

  async listForMailbox(mailboxId: string): Promise<MessageTemplate[]> {
    const rows = await this.repo.find({ where: { mailboxId } });
    return rows
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
      .map(toTemplateView);
  }

  async findForUser(userId: string, id: string): Promise<MessageTemplate> {
    return toTemplateView(await this.findVisible(userId, id));
  }

  async create(
    userId: string,
    mailboxId: string,
    dto: CreateTemplateDto,
  ): Promise<MessageTemplate> {
    if ((await this.repo.count({ where: { mailboxId } })) >= MAX_TEMPLATES_PER_MAILBOX) {
      throw new BadRequestException(
        `La casilla ya tiene ${MAX_TEMPLATES_PER_MAILBOX} plantillas (el máximo)`,
      );
    }
    const row = this.repo.create({
      mailboxId,
      name: dto.name,
      subject: normalizeSubject(dto.subject),
      body: sanitizeEmailHtml(dto.body),
      createdBy: userId,
      updatedBy: userId,
    });
    return toTemplateView(await this.saveUnique(row));
  }

  async update(userId: string, id: string, dto: UpdateTemplateDto): Promise<MessageTemplate> {
    const row = await this.findVisible(userId, id);
    // `@IsOptional` deja pasar null: en name y body cuenta como "no cambia".
    if (dto.name) row.name = dto.name;
    if (dto.subject !== undefined) row.subject = normalizeSubject(dto.subject);
    if (typeof dto.body === 'string') row.body = sanitizeEmailHtml(dto.body);
    row.updatedBy = userId;
    return toTemplateView(await this.saveUnique(row));
  }

  async remove(userId: string, id: string): Promise<void> {
    const row = await this.findVisible(userId, id);
    await this.repo.delete({ id: row.id });
  }

  // ---------------------------------------------------------------------------

  private async findVisible(userId: string, id: string): Promise<Template> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row || !(await this.access.hasPermission(userId, row.mailboxId, 'send'))) {
      throw new NotFoundException(NOT_FOUND);
    }
    return row;
  }

  private async saveUnique(row: Template): Promise<Template> {
    try {
      return await this.repo.save(row);
    } catch (err) {
      if (isUniqueViolation(err, UNIQUE_NAME_INDEX)) throw new ConflictException(DUPLICATE_NAME);
      throw err;
    }
  }
}

/** '' o null → sin asunto. */
function normalizeSubject(subject: string | null | undefined): string | null {
  const trimmed = subject?.trim();
  return trimmed ? trimmed : null;
}

/**
 * El comienzo del cuerpo en una línea de texto ("Hola, confirmamos la reunión
 * para…"): solo la primera línea muchas veces es un saludo que no distingue nada.
 */
export function templatePreview(body: string): string {
  return toSnippet(htmlToPlainText(body), PREVIEW_LENGTH);
}

export function toTemplateView(row: Template): MessageTemplate {
  return {
    id: row.id,
    mailboxId: row.mailboxId,
    name: row.name,
    preview: templatePreview(row.body),
    subject: row.subject,
    body: row.body,
  };
}
