import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError, type Repository } from 'typeorm';
import type { MailboxAccessService } from '../mailboxes/mailbox-access.service';
import type { Template } from './entities/template.entity';
import {
  MAX_TEMPLATES_PER_MAILBOX,
  templatePreview,
  TemplatesService,
  toTemplateView,
} from './templates.service';

const MBX = '11111111-1111-4111-8111-111111111111';
const TPL = '44444444-4444-4444-8444-444444444444';
const USER = 'u1';

function buildTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: TPL,
    mailboxId: MBX,
    name: 'Recordatorio de pago',
    subject: 'Cuota del mes',
    body: '<p>Hola,</p><p>Te recordamos que la cuota vence el <strong>[fecha]</strong>.</p>',
    createdBy: 'creator',
    updatedBy: 'creator',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function uniqueViolation(constraint: string): QueryFailedError {
  return new QueryFailedError(
    'INSERT',
    [],
    Object.assign(new Error('dup'), { code: '23505', constraint }),
  );
}

describe('templatePreview', () => {
  it('el comienzo del cuerpo en una línea de texto', () => {
    expect(templatePreview(buildTemplate().body)).toBe(
      'Hola, Te recordamos que la cuota vence el [fecha].',
    );
  });

  it('recorta los largos con "…"', () => {
    const preview = templatePreview(`<p>${'palabra '.repeat(40)}</p>`);
    expect(preview.length).toBe(80);
    expect(preview.endsWith('…')).toBe(true);
  });
});

describe('toTemplateView', () => {
  it('arma el MessageTemplate del frontend + subject y mailboxId', () => {
    expect(toTemplateView(buildTemplate())).toEqual({
      id: TPL,
      mailboxId: MBX,
      name: 'Recordatorio de pago',
      preview: 'Hola, Te recordamos que la cuota vence el [fecha].',
      subject: 'Cuota del mes',
      body: buildTemplate().body,
    });
  });
});

describe('TemplatesService', () => {
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  };
  let canSend: boolean;
  let access: { hasPermission: jest.Mock };
  let service: TemplatesService;

  beforeEach(() => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(buildTemplate()),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((data: Partial<Template>) => ({ ...data })),
      save: jest.fn((row: Partial<Template>) =>
        Promise.resolve(buildTemplate({ ...row, id: row.id ?? TPL })),
      ),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    canSend = true;
    access = { hasPermission: jest.fn(() => Promise.resolve(canSend)) };
    service = new TemplatesService(
      repo as unknown as Repository<Template>,
      access as unknown as MailboxAccessService,
    );
  });

  it('lista las de la casilla ordenadas por nombre (sin importar mayúsculas ni tildes)', async () => {
    repo.find.mockResolvedValue([
      buildTemplate({ id: 'c', name: 'convenio' }),
      buildTemplate({ id: 'a', name: 'Álta de socio' }),
      buildTemplate({ id: 'b', name: 'Bienvenida' }),
    ]);
    const list = await service.listForMailbox(MBX);
    expect(repo.find).toHaveBeenCalledWith({ where: { mailboxId: MBX } });
    expect(list.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  describe('alta', () => {
    it('sanitiza el cuerpo, guarda el autor y deja sin asunto si viene vacío', async () => {
      await service.create(USER, MBX, {
        name: 'Bienvenida',
        subject: '  ',
        body: '<p>Hola <script>x</script>!</p>',
      });
      expect(repo.create).toHaveBeenCalledWith({
        mailboxId: MBX,
        name: 'Bienvenida',
        subject: null,
        body: '<p>Hola !</p>',
        createdBy: USER,
        updatedBy: USER,
      });
    });

    it('guarda el asunto si viene', async () => {
      await service.create(USER, MBX, { name: 'x', subject: 'Asunto', body: '<p>x</p>' });
      expect((repo.create.mock.calls[0][0] as Template).subject).toBe('Asunto');
    });

    it('409 con un nombre que ya existe en la casilla', async () => {
      repo.save.mockRejectedValue(uniqueViolation('templates_mailbox_name_key'));
      await expect(
        service.create(USER, MBX, { name: 'Bienvenida', body: '<p>x</p>' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('otros errores de la base pasan tal cual', async () => {
      repo.save.mockRejectedValue(new Error('db'));
      await expect(service.create(USER, MBX, { name: 'x', body: '<p>x</p>' })).rejects.toThrow(
        'db',
      );
    });

    it('400 al llegar al máximo de plantillas por casilla', async () => {
      repo.count.mockResolvedValue(MAX_TEMPLATES_PER_MAILBOX);
      await expect(
        service.create(USER, MBX, { name: 'x', body: '<p>x</p>' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('detalle, edición y borrado', () => {
    it('404 si no existe o si no tiene canSend en su casilla', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      await expect(service.findForUser(USER, TPL)).rejects.toBeInstanceOf(NotFoundException);
      canSend = false;
      await expect(service.findForUser(USER, TPL)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.update(USER, TPL, { name: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.remove(USER, TPL)).rejects.toBeInstanceOf(NotFoundException);
      expect(access.hasPermission).toHaveBeenCalledWith(USER, MBX, 'send');
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('edita solo lo que viene y registra quién editó', async () => {
      await service.update(USER, TPL, { body: '<p>Nuevo <img src=x onerror=alert(1)></p>' });
      const saved = repo.save.mock.calls[0][0] as Template;
      expect(saved.name).toBe('Recordatorio de pago');
      expect(saved.subject).toBe('Cuota del mes');
      expect(saved.body).not.toContain('onerror');
      expect(saved.updatedBy).toBe(USER);
    });

    it('subject null (o vacío) quita el asunto; omitirlo lo deja igual', async () => {
      await service.update(USER, TPL, { subject: null });
      expect((repo.save.mock.calls[0][0] as Template).subject).toBeNull();
      repo.findOne.mockResolvedValue(buildTemplate());
      await service.update(USER, TPL, { name: 'Otro' });
      expect((repo.save.mock.calls[1][0] as Template).subject).toBe('Cuota del mes');
    });

    it('renombrar a un nombre existente → 409', async () => {
      repo.save.mockRejectedValue(uniqueViolation('templates_mailbox_name_key'));
      await expect(service.update(USER, TPL, { name: 'Otro' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('borra', async () => {
      await service.remove(USER, TPL);
      expect(repo.delete).toHaveBeenCalledWith({ id: TPL });
    });
  });
});
