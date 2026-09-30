import type { TransformFnParams } from 'class-transformer';

/** Para `@Transform(trimString)`: recorta espacios si el valor es string. */
export function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}
