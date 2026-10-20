import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isUniqueViolation } from '../common/postgres-errors';
import { htmlToPlainText, sanitizeEmailHtml, toSnippet } from '../messages/content/html-content';
import type { CreateTemplateDto } from './dto/create-template.dto';
import type { UpdateTemplateDto } from './dto/update-template.dto';
import { Template } from './entities/template.entity';
import { templateNameKey } from './template-name';
import type { MessageTemplate } from './templates.types';

/** Máximo de plantillas por casilla. */
export const MAX_TEMPLATES_PER_MAILBOX = 100;
/** Largo del `preview` (lo que entra en la fila del selector y de la pantalla Plantillas). */
export const PREVIEW_LENGTH = 48;

export const TEMPLATE_NAME_TAKEN = 'TEMPLATE_NAME_TAKEN';
const NOT_FOUND = 'La plantilla no existe';
const UNIQUE_NAME_INDEX = 'templates_mailbox_name_key_unique';

/** 409 con `code` para que el front lo muestre junto al campo del nombre. */
export class TemplateNameTakenException extends ConflictException {
  constructor() {
    super({
      statusCode: 409,
      error: 'Conflict',
      code: TEMPLATE_NAME_TAKEN,
      message: 'Ya existe una plantilla con ese nombre en esta casilla',
    });
  }
}

/**
 * Plantillas por casilla. Las usa y las gestiona cualquiera con canSend en la
 * casilla (el selector está en Redactar): todas las rutas cuelgan de
 * `/mailboxes/:mailboxId/templates` y el permiso lo chequea
 * `@RequireMailboxAccess('send')`. Una plantilla de otra casilla → 404.
 */
@Injectable()
export class TemplatesService {
  constructor(@InjectRepository(Template) private readonly repo: Repository<Template>) {}

  async listForMailbox(mailboxId: string): Promise<MessageTemplate[]> {
    const rows = await this.repo.find({ where: { mailboxId } });
    rows.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
    return this.toViews(rows);
  }

  async findInMailbox(mailboxId: string, id: string): Promise<MessageTemplate> {
    return (await this.toViews([await this.getInMailbox(mailboxId, id)]))[0];
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
      nameKey: templateNameKey(dto.name),
      subject: normalizeSubject(dto.subject),
      body: sanitizeEmailHtml(dto.body),
      createdBy: userId,
      updatedBy: userId,
    });
    return (await this.toViews([await this.saveUnique(row)]))[0];
  }

  async update(
    userId: string,
    mailboxId: string,
    id: string,
    dto: UpdateTemplateDto,
  ): Promise<MessageTemplate> {
    const row = await this.getInMailbox(mailboxId, id);
    // `@IsOptional` deja pasar null: en name y body cuenta como "no cambia".
    if (dto.name) {
      row.name = dto.name;
      row.nameKey = templateNameKey(dto.name);
    }
    if (dto.subject !== undefined) row.subject = normalizeSubject(dto.subject);
    if (typeof dto.body === 'string') row.body = sanitizeEmailHtml(dto.body);
    row.updatedBy = userId;
    return (await this.toViews([await this.saveUnique(row)]))[0];
  }

  async remove(mailboxId: string, id: string): Promise<void> {
    const row = await this.getInMailbox(mailboxId, id);
    await this.repo.delete({ id: row.id });
  }

  // ---------------------------------------------------------------------------

  private async getInMailbox(mailboxId: string, id: string): Promise<Template> {
    const row = await this.repo.findOne({ where: { id, mailboxId } });
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  private async saveUnique(row: Template): Promise<Template> {
    try {
      return await this.repo.save(row);
    } catch (err) {
      if (isUniqueViolation(err, UNIQUE_NAME_INDEX)) throw new TemplateNameTakenException();
      throw err;
    }
  }

  /** Arma las respuestas con el nombre de quien editó (una sola consulta para todas). */
  private async toViews(rows: Template[]): Promise<MessageTemplate[]> {
    const ids = [...new Set(rows.map((r) => r.updatedBy).filter((id): id is string => !!id))];
    const names = new Map<string, string>();
    if (ids.length > 0) {
      const profiles = await this.repo.manager.query<{ id: string; name: string }[]>(
        `SELECT id, name FROM public.user_profiles WHERE id = ANY($1::uuid[])`,
        [ids],
      );
      for (const p of profiles) names.set(p.id, p.name);
    }
    return rows.map((row) =>
      toTemplateView(row, row.updatedBy ? (names.get(row.updatedBy) ?? null) : null),
    );
  }
}

/** '' o null → sin asunto. */
function normalizeSubject(subject: string | null | undefined): string | null {
  const trimmed = subject?.trim();
  return trimmed ? trimmed : null;
}

/** El comienzo del cuerpo en una línea de texto ("Hola, confirmamos la reunión…"). */
export function templatePreview(body: string): string {
  return toSnippet(htmlToPlainText(body), PREVIEW_LENGTH);
}

export function toTemplateView(row: Template, updatedByName: string | null): MessageTemplate {
  return {
    id: row.id,
    mailboxId: row.mailboxId,
    name: row.name,
    preview: templatePreview(row.body),
    subject: row.subject,
    body: row.body,
    updatedAt: row.updatedAt.toISOString(),
    updatedByName,
  };
}
