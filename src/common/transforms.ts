import { type ClassConstructor, plainToInstance, type TransformFnParams } from 'class-transformer';

/** Para `@Transform(trimString)`: recorta espacios si el valor es string. */
export function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** Para `@Transform(trimLowerString)`: recorta espacios y pasa a minúsculas (emails). */
export function trimLowerString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

/**
 * Para `@Transform(toArrayField(Dto))` en campos que son listas y pueden llegar
 * por JSON (array) o por multipart/form-data, donde llegan como texto:
 * - un JSON (`'[{"messageId":"…"}]'` / `'["1","2"]'`) se parsea;
 * - con multer, `campo[0][clave]=…` ya llega como array de objetos;
 * - un string suelto (`keepAttachmentIds=1`) cuenta como lista de uno, solo
 *   para listas de strings (sin `cls`).
 * Con `cls`, cada objeto se convierte a esa clase para que `@ValidateNested` lo
 * valide. Cualquier otra cosa se devuelve igual y la rechaza `@IsArray`.
 */
export function toArrayField<T extends object>(cls?: ClassConstructor<T>) {
  return ({ value }: TransformFnParams): unknown => {
    const raw: unknown = value;
    let parsed = raw;
    if (typeof parsed === 'string') {
      const text = parsed.trim();
      if (text.startsWith('[')) {
        try {
          parsed = JSON.parse(text) as unknown;
        } catch {
          return raw;
        }
      } else if (!cls) {
        return text === '' ? [] : [text];
      }
    }
    if (!Array.isArray(parsed) || !cls) return parsed;
    return parsed.map((item: unknown) =>
      typeof item === 'object' && item !== null ? plainToInstance(cls, item) : item,
    );
  };
}
