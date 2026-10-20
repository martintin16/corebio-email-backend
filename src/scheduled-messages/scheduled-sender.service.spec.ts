import { BadGatewayException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import {
  type GoogleMailboxClient,
  MailboxNeedsReconnectException,
} from '../google/google-mailbox-client';
import type { MailboxAccessService } from '../mailboxes/mailbox-access.service';
import type { MessagesService } from '../messages/messages.service';
import {
  BATCH_SIZE,
  type ClaimedRow,
  ERRORS,
  ScheduledSenderService,
  TICK_MS,
} from './scheduled-sender.service';

const MBX = '11111111-1111-4111-8111-111111111111';

const claimed = (overrides: Partial<ClaimedRow> = {}): ClaimedRow => ({
  id: 'sch-1',
  mailbox_id: MBX,
  gmail_draft_id: 'r-draft1',
  responsible: 'u1',
  attempts: 1,
  ...overrides,
});

describe('ScheduledSenderService', () => {
  let rows: ClaimedRow[];
  let profileStatus: string | undefined;
  let dataSource: { query: jest.Mock };
  let messages: { sendDraft: jest.Mock; isDraftTrashed: jest.Mock };
  let google: { forMailbox: jest.Mock };
  let access: { hasPermission: jest.Mock };
  let config: { get: jest.Mock };
  let sender: ScheduledSenderService;

  /** Las sentencias que mandó el job, sin las de la toma ni la de permisos. */
  const updates = () =>
    (dataSource.query.mock.calls as [string, unknown[]][]).filter(
      ([sql]) => !sql.includes('FOR UPDATE SKIP LOCKED') && !sql.includes('user_profiles'),
    );
  const lastUpdate = (): [string, unknown[]] => updates().at(-1) ?? ['', []];

  beforeEach(() => {
    rows = [claimed()];
    profileStatus = 'active';
    dataSource = {
      query: jest.fn((sql: string) => {
        if (sql.includes('FOR UPDATE SKIP LOCKED')) return Promise.resolve([rows, rows.length]);
        if (sql.includes('user_profiles')) {
          return Promise.resolve(profileStatus ? [{ status: profileStatus }] : []);
        }
        return Promise.resolve([[], 0]);
      }),
    };
    messages = {
      sendDraft: jest.fn().mockResolvedValue({ messageId: 'sent0001', threadId: 'thr1' }),
      isDraftTrashed: jest.fn().mockResolvedValue(false),
    };
    google = { forMailbox: jest.fn((mailboxId: string) => Promise.resolve({ mailboxId })) };
    access = { hasPermission: jest.fn().mockResolvedValue(true) };
    config = { get: jest.fn() };
    sender = new ScheduledSenderService(
      dataSource as unknown as DataSource,
      messages as unknown as MessagesService,
      google as unknown as GoogleMailboxClient,
      access as unknown as MailboxAccessService,
      config as unknown as ConfigService,
    );
  });

  it('cada vuelta: primero marca los colgados, después toma los vencidos', async () => {
    rows = [];
    await sender.tick();
    const [first, second] = dataSource.query.mock.calls as [string, unknown[]][];
    expect(first[0]).toContain("WHERE status = 'sending'");
    expect(first[1]).toEqual([ERRORS.stuck, 10]);
    expect(second[0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(second[0]).toContain('COALESCE(updated_by, created_by) AS responsible');
    expect(second[1]).toEqual([BATCH_SIZE]);
    expect(messages.sendDraft).not.toHaveBeenCalled();
  });

  it('envía el borrador y marca sent con los ids de Gmail', async () => {
    await sender.tick();
    expect(access.hasPermission).toHaveBeenCalledWith('u1', MBX, 'send');
    expect(messages.sendDraft).toHaveBeenCalledWith({ mailboxId: MBX }, 'r-draft1');
    const [sql, params] = lastUpdate();
    expect(sql).toContain("status = 'sent'");
    expect(params).toEqual(['sch-1', 'sent0001', 'thr1']);
  });

  it.each([
    ['ya no tiene canSend', () => access.hasPermission.mockResolvedValue(false)],
    ['está desactivado', () => (profileStatus = 'inactive')],
    ['se borró el usuario', () => (profileStatus = undefined)],
  ])('falla sin enviar si quien lo programó %s', async (_case, setup) => {
    setup();
    await sender.tick();
    expect(messages.sendDraft).not.toHaveBeenCalled();
    const [sql, params] = lastUpdate();
    expect(sql).toContain("status = 'failed'");
    expect(params).toEqual(['sch-1', ERRORS.noPermission]);
  });

  it('sin responsable (null) también falla', async () => {
    rows = [claimed({ responsible: null })];
    await sender.tick();
    expect(lastUpdate()[1]).toEqual(['sch-1', ERRORS.noPermission]);
  });

  it('casilla que necesita reconectarse → failed sin reintentos', async () => {
    google.forMailbox.mockRejectedValue(new MailboxNeedsReconnectException());
    await sender.tick();
    expect(lastUpdate()[1]).toEqual(['sch-1', ERRORS.needsReconnect]);
  });

  it('antes de enviar revisa que el borrador no esté en la Papelera', async () => {
    await sender.tick();
    expect(messages.isDraftTrashed).toHaveBeenCalledWith({ mailboxId: MBX }, 'r-draft1');
    expect(messages.sendDraft).toHaveBeenCalled();
  });

  it('borrador en la Papelera (se borró desde Gmail) → failed sin enviar', async () => {
    messages.isDraftTrashed.mockResolvedValue(true);
    await sender.tick();
    expect(messages.sendDraft).not.toHaveBeenCalled();
    const [sql, params] = lastUpdate();
    expect(sql).toContain("status = 'failed'");
    expect(params).toEqual(['sch-1', ERRORS.draftTrashed]);
  });

  it('borrador eliminado para siempre (404 al revisarlo) → failed sin enviar', async () => {
    messages.isDraftTrashed.mockRejectedValue(new NotFoundException());
    await sender.tick();
    expect(messages.sendDraft).not.toHaveBeenCalled();
    expect(lastUpdate()[1]).toEqual(['sch-1', ERRORS.draftMissing]);
  });

  it('borrador que ya no existe → failed (nunca duplica el envío)', async () => {
    messages.sendDraft.mockRejectedValue(new NotFoundException());
    await sender.tick();
    expect(lastUpdate()[1]).toEqual(['sch-1', ERRORS.draftMissing]);
  });

  it.each([
    [1, 1],
    [2, 5],
    [3, 15],
  ])('error transitorio en el intento %i → reintenta en %i min', async (attempts, minutes) => {
    rows = [claimed({ attempts })];
    messages.sendDraft.mockRejectedValue(new BadGatewayException('Google no respondió'));
    await sender.tick();
    const [sql, params] = lastUpdate();
    expect(sql).toContain("status = 'pending'");
    expect(params).toEqual(['sch-1', minutes, 'Google no respondió']);
  });

  it('después del cuarto intento queda failed', async () => {
    rows = [claimed({ attempts: 4 })];
    messages.sendDraft.mockRejectedValue(new BadGatewayException('Google no respondió'));
    await sender.tick();
    const [sql, params] = lastUpdate();
    expect(sql).toContain("status = 'failed'");
    expect(params[1]).toMatch(/después de 4 intentos/);
  });

  it('un error en una fila no frena las demás', async () => {
    rows = [claimed({ id: 'a' }), claimed({ id: 'b' })];
    messages.sendDraft
      .mockRejectedValueOnce(new NotFoundException())
      .mockResolvedValueOnce({ messageId: 'm2', threadId: null });
    await sender.tick();
    expect(messages.sendDraft).toHaveBeenCalledTimes(2);
    expect(lastUpdate()[1]).toEqual(['b', 'm2', null]);
  });

  it('si la base falla, la vuelta no rompe y la siguiente corre', async () => {
    dataSource.query.mockRejectedValueOnce(new Error('db caída'));
    await expect(sender.tick()).resolves.toBeUndefined();
    await sender.tick();
    expect(messages.sendDraft).toHaveBeenCalledTimes(1);
  });

  it('no superpone vueltas', async () => {
    let release: () => void = () => undefined;
    dataSource.query.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve([[], 0]))),
    );
    const first = sender.tick();
    await sender.tick(); // la anterior sigue corriendo: no hace nada
    expect(dataSource.query).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  describe('timer', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('corre cada minuto y se apaga al cerrar la app', () => {
      const tick = jest.spyOn(sender, 'tick').mockResolvedValue(undefined);
      sender.onApplicationBootstrap();
      jest.advanceTimersByTime(TICK_MS * 2);
      expect(tick).toHaveBeenCalledTimes(2);
      sender.onModuleDestroy();
      jest.advanceTimersByTime(TICK_MS);
      expect(tick).toHaveBeenCalledTimes(2);
    });

    it('SCHEDULED_SENDER_ENABLED=false no lo arranca', () => {
      config.get.mockReturnValue(false);
      const tick = jest.spyOn(sender, 'tick').mockResolvedValue(undefined);
      sender.onApplicationBootstrap();
      jest.advanceTimersByTime(TICK_MS * 2);
      expect(tick).not.toHaveBeenCalled();
    });
  });
});
