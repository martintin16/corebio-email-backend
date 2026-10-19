import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUserDto } from './create-user.dto';
import { isMailboxAccessRecord } from './is-mailbox-access-record.validator';

const MBX = '11111111-1111-4111-8111-111111111111';

describe('isMailboxAccessRecord', () => {
  it.each([
    [{}],
    [{ [MBX]: { canSend: true, canRead: false } }],
    [{ [MBX]: { canRead: false, canSend: false } }],
  ])('acepta %p', (value) => {
    expect(isMailboxAccessRecord(value)).toBe(true);
  });

  it.each([
    [null],
    [[]],
    ['x'],
    [{ mbx_1: { canSend: true, canRead: true } }],
    [{ [MBX]: { canSend: 'true', canRead: true } }],
    [{ [MBX]: { canSend: true } }],
    [{ [MBX]: { canSend: true, canRead: true, admin: true } }],
    [{ [MBX]: true }],
  ])('rechaza %p', (value) => {
    expect(isMailboxAccessRecord(value)).toBe(false);
  });
});

describe('CreateUserDto', () => {
  const build = (body: Record<string, unknown>) => plainToInstance(CreateUserDto, body);

  it('normaliza nombre y email', async () => {
    const dto = build({
      name: '  Ana  ',
      email: ' Ana@Gmail.COM ',
      role: 'user',
      access: {},
    });
    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.name).toBe('Ana');
    expect(dto.email).toBe('ana@gmail.com');
  });

  it('rechaza rol desconocido y access mal formado', async () => {
    const errors = await validate(
      build({ name: 'Ana', email: 'ana@gmail.com', role: 'owner', access: { x: 1 } }),
    );
    expect(errors.map((e) => e.property).sort()).toEqual(['access', 'role']);
  });
});
