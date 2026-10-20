import { BadRequestException, NotFoundException } from '@nestjs/common';
import { QueryFailedError, type Repository } from 'typeorm';
import type { Template } from './entities/template.entity';
import { templateNameKey } from './template-name';
import {
  MAX_TEMPLATES_PER_MAILBOX,
  TEMPLATE_NAME_TAKEN,
  TemplateNameTakenException,
  templatePreview,
  TemplatesService,
  toTemplateView,
} from './templates.service';

const MBX = '11111111-1111-4111-8111-111111111111';
const TPL = '44444444-4444-4444-8444-444444444444';
const USER = 'u1';
const UPDATED = new Date('2026-10-20T12:00:00.000Z');

function buildTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: TPL,
    mailboxId: MBX,
    name: 'Recordatorio de pago',
    nameKey: 'recordatorio de pago',
    subject: 'Cuota del mes',
    body: '<p>Hola,</p><p>Te recordamos que la cuota vence el <strong>[fecha]</strong>.</p>',
    createdBy: 'creator',
    updatedBy: 'editor',
    createdAt: UPDATED,
    updatedAt: UPDATED,
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

describe('templateNameKey', () => {
  it('ignora tildes, mayúsculas y espacios de más', () => {
    expect(templateNameKey('  Confirmación   de PAGO ')).toBe('confirmacion de pago');
    expect(templateNameKey('Confirmacion de pago')).toBe(templateNameKey('CONFIRMACIÓN de pago'));
  });
});

describe('templatePreview', () => {
  it('el comienzo del cuerpo en una línea de texto, hasta 48 caracteres', () => {
    const preview = templatePreview(buildTemplate().body);
    expect(preview.length).toBeLessThanOrEqual(48);
    expect(preview.startsWith('Hola, Te recordamos que la cuota')).toBe(true);
    expect(preview.endsWith('…')).toBe(true);
  });
});

describe('toTemplateView', () => {
  it('arma el MessageTemplate del front con subject, updatedAt y updatedByName', () => {
    expect(toTemplateView(buildTemplate(), 'Ana')).toEqual({
      id: TPL,
      mailboxId: MBX,
      name: 'Recordatorio de pago',
      preview: templatePreview(buildTemplate().body),
      subject: 'Cuota del mes',
      body: buildTemplate().body,
      updatedAt: '2026-10-20T12:00:00.000Z',
      updatedByName: 'Ana',
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
    manager: { query: jest.Mock };
  };
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
      manager: {
        query: jest.fn().mockResolvedValue([
          { id: 'editor', name: 'Ana Editora' },
          { id: USER, name: 'Usuario' },
        ]),
      },
    };
    service = new TemplatesService(repo as unknown as Repository<Template>);
  });

  it('lista por nombre (sin importar mayúsculas ni tildes) con quién editó cada una', async () => {
    repo.find.mockResolvedValue([
      buildTemplate({ id: 'c', name: 'convenio' }),
      buildTemplate({ id: 'a', name: 'Álta de socio', updatedBy: null }),
      buildTemplate({ id: 'b', name: 'Bienvenida' }),
    ]);
    const list = await service.listForMailbox(MBX);
    expect(repo.find).toHaveBeenCalledWith({ where: { mailboxId: MBX } });
    expect(list.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(list.map((t) => t.updatedByName)).toEqual([null, 'Ana Editora', 'Ana Editora']);
    // Una sola consulta de nombres para toda la lista.
    expect(repo.manager.query).toHaveBeenCalledTimes(1);
    expect(repo.manager.query.mock.calls[0][1]).toEqual([['editor']]);
  });

  it('sin plantillas no consulta nombres', async () => {
    expect(await service.listForMailbox(MBX)).toEqual([]);
    expect(repo.manager.query).not.toHaveBeenCalled();
  });

  describe('alta', () => {
    it('sanitiza el cuerpo, guarda la clave del nombre y el autor; asunto vacío → null', async () => {
      const view = await service.create(USER, MBX, {
        name: 'Confirmación',
        subject: '  ',
        body: '<p>Hola <script>x</script>!</p>',
      });
      expect(repo.create).toHaveBeenCalledWith({
        mailboxId: MBX,
        name: 'Confirmación',
        nameKey: 'confirmacion',
        subject: null,
        body: '<p>Hola !</p>',
        createdBy: USER,
        updatedBy: USER,
      });
      expect(view.updatedByName).toBe('Usuario');
    });

    it('nombre repetido (sin importar tildes) → 409 TEMPLATE_NAME_TAKEN', async () => {
      repo.save.mockRejectedValue(uniqueViolation('templates_mailbox_name_key_unique'));
      const err = (await service
        .create(USER, MBX, { name: 'confirmacion', body: '<p>x</p>' })
        .catch((e: unknown) => e)) as TemplateNameTakenException;
      expect(err).toBeInstanceOf(TemplateNameTakenException);
      expect(err.getResponse()).toEqual(expect.objectContaining({ code: TEMPLATE_NAME_TAKEN }));
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
    it('buscan la plantilla DENTRO de la casilla: de otra casilla → 404', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.findInMailbox(MBX, TPL)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.update(USER, MBX, TPL, { name: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.remove(MBX, TPL)).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: TPL, mailboxId: MBX } });
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('edita solo lo que viene, actualiza la clave si cambia el nombre y registra quién editó', async () => {
      await service.update(USER, MBX, TPL, { name: 'Recordatorio Ñandú' });
      const saved = repo.save.mock.calls[0][0] as Template;
      expect(saved.name).toBe('Recordatorio Ñandú');
      expect(saved.nameKey).toBe('recordatorio nandu');
      expect(saved.subject).toBe('Cuota del mes');
      expect(saved.updatedBy).toBe(USER);
    });

    it('cuerpo nuevo se sanitiza; subject null lo quita', async () => {
      await service.update(USER, MBX, TPL, {
        body: '<p>Nuevo <img src=x onerror=alert(1)></p>',
        subject: null,
      });
      const saved = repo.save.mock.calls[0][0] as Template;
      expect(saved.body).not.toContain('onerror');
      expect(saved.subject).toBeNull();
      expect(saved.nameKey).toBe('recordatorio de pago');
    });

    it('renombrar a un nombre existente → 409 TEMPLATE_NAME_TAKEN', async () => {
      repo.save.mockRejectedValue(uniqueViolation('templates_mailbox_name_key_unique'));
      await expect(service.update(USER, MBX, TPL, { name: 'Otro' })).rejects.toBeInstanceOf(
        TemplateNameTakenException,
      );
    });

    it('borra', async () => {
      await service.remove(MBX, TPL);
      expect(repo.delete).toHaveBeenCalledWith({ id: TPL });
    });
  });
});
