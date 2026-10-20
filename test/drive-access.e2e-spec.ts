import request from 'supertest';
import { DriveAccessController } from '../src/drive-access/drive-access.controller';
import { DriveAccessService } from '../src/drive-access/drive-access.service';
import { ADMIN_ID, createTestApp, type TestApp, USER_ID } from './utils/test-app';

const MBX = '11111111-2222-4333-8444-555555555555';
const TARGET = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const FOLDER = '1AbCdEfGhIjKlMnOp';

describe('Drive access (e2e)', () => {
  let t: TestApp;
  const drive = {
    listItems: jest.fn(),
    listSharedIds: jest.fn(),
    applyAccess: jest.fn(),
  };

  beforeAll(async () => {
    t = await createTestApp({
      controllers: [DriveAccessController],
      providers: [{ provide: DriveAccessService, useValue: drive }],
    });
  });

  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    drive.listItems.mockResolvedValue([]);
    drive.listSharedIds.mockResolvedValue(['a']);
    drive.applyAccess.mockResolvedValue({ added: [], removed: [], failed: [] });
  });

  const http = () => request(t.app.getHttpServer());
  const asAdmin = () => t.authHeader(ADMIN_ID);

  it('solo admin: un user común → 403; sin token → 401', async () => {
    await http()
      .get(`/mailboxes/${MBX}/drive/shared?userId=${TARGET}`)
      .set('Authorization', await t.authHeader(USER_ID))
      .expect(403);
    await http()
      .put(`/mailboxes/${MBX}/drive/access/${TARGET}`)
      .set('Authorization', await t.authHeader(USER_ID))
      .send({ itemIds: [] })
      .expect(403);
    await http().get(`/mailboxes/${MBX}/drive/shared?userId=${TARGET}`).expect(401);
    expect(drive.listSharedIds).not.toHaveBeenCalled();
  });

  it('items: carpeta "root" por defecto, o la pedida', async () => {
    const auth = await asAdmin();
    await http()
      .get(`/mailboxes/${MBX}/drive/items?userId=${TARGET}`)
      .set('Authorization', auth)
      .expect(200, []);
    expect(drive.listItems).toHaveBeenCalledWith(MBX, 'root', TARGET);

    await http()
      .get(`/mailboxes/${MBX}/drive/items?userId=${TARGET}&folderId=${FOLDER}`)
      .set('Authorization', auth)
      .expect(200);
    expect(drive.listItems).toHaveBeenLastCalledWith(MBX, FOLDER, TARGET);
  });

  it.each([
    ['sin userId', `/mailboxes/${MBX}/drive/items`],
    ['userId que no es uuid', `/mailboxes/${MBX}/drive/items?userId=u1`],
    ['folderId inválido', `/mailboxes/${MBX}/drive/items?userId=${TARGET}&folderId=../x`],
    ['mailboxId inválido', `/mailboxes/mbx_1/drive/shared?userId=${TARGET}`],
  ])('400 con %s', async (_case, path) => {
    await http()
      .get(path)
      .set('Authorization', await asAdmin())
      .expect(400);
    expect(drive.listItems).not.toHaveBeenCalled();
  });

  it('shared devuelve los ids', async () => {
    await http()
      .get(`/mailboxes/${MBX}/drive/shared?userId=${TARGET}`)
      .set('Authorization', await asAdmin())
      .expect(200, ['a']);
    expect(drive.listSharedIds).toHaveBeenCalledWith(MBX, TARGET);
  });

  it('PUT access aplica la selección final', async () => {
    await http()
      .put(`/mailboxes/${MBX}/drive/access/${TARGET}`)
      .set('Authorization', await asAdmin())
      .send({ itemIds: [FOLDER, 'root'] })
      .expect(200, { added: [], removed: [], failed: [] });
    expect(drive.applyAccess).toHaveBeenCalledWith(MBX, TARGET, [FOLDER, 'root']);
  });

  it.each([
    ['sin itemIds', {}],
    ['itemIds que no es lista', { itemIds: FOLDER }],
    ['un id inválido', { itemIds: ["x' or 1=1"] }],
    ['más de 200', { itemIds: Array.from({ length: 201 }, (_, i) => `${FOLDER}${i}`) }],
    ['campo de más', { itemIds: [], role: 'owner' }],
  ])('PUT 400 con %s', async (_case, body) => {
    await http()
      .put(`/mailboxes/${MBX}/drive/access/${TARGET}`)
      .set('Authorization', await asAdmin())
      .send(body)
      .expect(400);
    expect(drive.applyAccess).not.toHaveBeenCalled();
  });
});
