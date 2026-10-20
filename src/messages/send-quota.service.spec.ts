import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import {
  isGmailSendingLimitError,
  RECIPIENT_LIMIT_EXCEEDED,
  RecipientLimitExceededException,
  SendQuotaService,
} from './send-quota.service';

const MBX = '11111111-1111-4111-8111-111111111111';

describe('SendQuotaService', () => {
  let used: string;
  let dataSource: { query: jest.Mock };
  let quota: SendQuotaService;

  beforeEach(() => {
    used = '0';
    dataSource = {
      query: jest.fn((sql: string) =>
        Promise.resolve(sql.includes('SUM(recipients)') ? [{ used }] : []),
      ),
    };
    quota = new SendQuotaService(
      dataSource as unknown as DataSource,
      new ConfigService({ MAILBOX_DAILY_RECIPIENT_LIMIT: 500 }),
    );
  });

  it('cuenta lo enviado en las últimas 24 horas', async () => {
    used = '480';
    expect(await quota.remaining(MBX)).toBe(20);
    const [sql, params] = dataSource.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("interval '24 hours'");
    expect(params).toEqual([MBX]);
  });

  it('nunca da negativo', async () => {
    used = '700';
    expect(await quota.remaining(MBX)).toBe(0);
  });

  it('deja pasar lo que entra y rechaza lo que no, con limit/remaining/requested', async () => {
    used = '495';
    await expect(quota.assertAvailable(MBX, 5)).resolves.toBeUndefined();
    const err = (await quota
      .assertAvailable(MBX, 6)
      .catch((e: unknown) => e)) as RecipientLimitExceededException;
    expect(err).toBeInstanceOf(RecipientLimitExceededException);
    expect(err.getStatus()).toBe(429);
    expect(err.getResponse()).toEqual(
      expect.objectContaining({
        code: RECIPIENT_LIMIT_EXCEEDED,
        limit: 500,
        remaining: 5,
        requested: 6,
      }),
    );
  });

  it('el límite sale de MAILBOX_DAILY_RECIPIENT_LIMIT (500 si no está)', () => {
    expect(
      new SendQuotaService(dataSource as unknown as DataSource, new ConfigService({})).limit,
    ).toBe(500);
    expect(
      new SendQuotaService(
        dataSource as unknown as DataSource,
        new ConfigService({ MAILBOX_DAILY_RECIPIENT_LIMIT: 2000 }),
      ).limit,
    ).toBe(2000);
  });

  it('record anota el envío y limpia lo viejo; si falla, no tira error', async () => {
    await quota.record(MBX, 3, 'compose');
    expect(dataSource.query.mock.calls[0]).toEqual([
      expect.stringContaining('INSERT INTO public.mailbox_send_log'),
      [MBX, 3, 'compose'],
    ]);
    expect(dataSource.query.mock.calls[1][0]).toContain("interval '2 days'");

    dataSource.query.mockRejectedValue(new Error('db'));
    await expect(quota.record(MBX, 1, 'reply')).resolves.toBeUndefined();
  });
});

describe('isGmailSendingLimitError', () => {
  it.each([
    [{ errors: [{ reason: 'dailyLimitExceeded' }] }, true],
    [{ response: { data: { error: { errors: [{ reason: 'dailyLimitExceeded' }] } } } }, true],
    [new Error('Daily user sending limit exceeded'), true],
    [new Error('User-rate limit exceeded. Retry after 2026-10-20T12:00:00Z'), false],
    [new Error('boom'), false],
    [null, false],
  ])('%p → %p', (err, expected) => {
    expect(isGmailSendingLimitError(err)).toBe(expected);
  });
});
