import { BadGatewayException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { GoogleMailboxClient } from '../google/google-mailbox-client';
import { SyncStateService } from './sync-state.service';

const MBX = '11111111-1111-4111-8111-111111111111';

describe('SyncStateService', () => {
  const getProfile = jest.fn();
  const getLabel = jest.fn();
  const google = {
    forMailbox: jest.fn(() =>
      Promise.resolve({ gmail: { users: { getProfile, labels: { get: getLabel } } } }),
    ),
    handleGoogleError: jest.fn(() => Promise.reject(new BadGatewayException('Google falló'))),
  };
  const dataSource = { query: jest.fn() };
  const service = new SyncStateService(
    google as unknown as GoogleMailboxClient,
    dataSource as unknown as DataSource,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    getProfile.mockResolvedValue({ data: { historyId: '98765' } });
    getLabel.mockResolvedValue({ data: { id: 'INBOX', messagesUnread: 3 } });
    dataSource.query.mockResolvedValue([{ total: '2', last: '1700000000000' }]);
  });

  it('devuelve el historyId de Gmail y la versión de los programados', async () => {
    await expect(service.getState(MBX)).resolves.toEqual({
      historyId: '98765',
      scheduledVersion: '2:1700000000000',
      inboxUnread: 3,
    });
    expect(getLabel).toHaveBeenCalledWith({ userId: 'me', id: 'INBOX' });
    expect(google.forMailbox).toHaveBeenCalledWith(MBX);
    expect(getProfile).toHaveBeenCalledWith({ userId: 'me' });
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('scheduled_messages'), [
      MBX,
    ]);
  });

  it('sin programados la versión es "0:"', async () => {
    dataSource.query.mockResolvedValue([{ total: '0', last: null }]);
    const state = await service.getState(MBX);
    expect(state.scheduledVersion).toBe('0:');
  });

  it('un error de Gmail pasa por handleGoogleError (reconectar, 502…)', async () => {
    const err = new Error('boom');
    getProfile.mockRejectedValue(err);
    await expect(service.getState(MBX)).rejects.toBeInstanceOf(BadGatewayException);
    expect(google.handleGoogleError).toHaveBeenCalledWith(MBX, err);
  });
});
