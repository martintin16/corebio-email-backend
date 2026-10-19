import { isUUID, registerDecorator, type ValidationOptions } from 'class-validator';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAccessFlags(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value).sort();
  return (
    keys.length === 2 &&
    keys[0] === 'canRead' &&
    keys[1] === 'canSend' &&
    typeof value.canRead === 'boolean' &&
    typeof value.canSend === 'boolean'
  );
}

/** true si `value` tiene la forma `Record<uuid, { canSend: boolean; canRead: boolean }>`. */
export function isMailboxAccessRecord(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return Object.entries(value).every(([key, flags]) => isUUID(key) && isAccessFlags(flags));
}

/**
 * Valida el campo `access` que manda el frontend:
 * `{ [mailboxId]: { canSend: boolean, canRead: boolean } }`.
 * Que las casillas existan lo valida después MailboxAccessService (necesita la base).
 */
export function IsMailboxAccessRecord(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isMailboxAccessRecord',
      target: target.constructor,
      propertyName: propertyName as string,
      options: {
        message:
          'access tiene que ser { [mailboxId uuid]: { canSend: boolean, canRead: boolean } }',
        ...options,
      },
      validator: { validate: isMailboxAccessRecord },
    });
  };
}
