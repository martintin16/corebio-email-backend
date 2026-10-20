import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { MAX_RECIPIENTS, parseRecipientField } from '../recipients';

/**
 * Campo de destinatarios: string con emails separados por coma (puede ser ''),
 * todos válidos y hasta MAX_RECIPIENTS.
 */
export function IsRecipientList(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isRecipientList',
      target: target.constructor,
      propertyName: propertyName as string,
      options: {
        message: (args: ValidationArguments) => {
          if (typeof args.value !== 'string') return `${args.property} tiene que ser texto`;
          const { emails, invalid } = parseRecipientField(args.value);
          if (invalid.length > 0) return `"${invalid[0]}" no es un email válido`;
          return `${args.property}: máximo ${MAX_RECIPIENTS} destinatarios (hay ${emails.length})`;
        },
        ...options,
      },
      validator: {
        validate: (value: unknown) => {
          if (typeof value !== 'string' || value.length > 50_000) return false;
          const { emails, invalid } = parseRecipientField(value);
          return invalid.length === 0 && emails.length <= MAX_RECIPIENTS;
        },
      },
    });
  };
}

/**
 * Al menos un destinatario entre to, cc y bcc (como Gmail y el `composeSchema`
 * del frontend). Va en `to` pero mira los tres campos.
 */
export function HasAnyRecipient(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'hasAnyRecipient',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: 'Ingresá al menos un destinatario', ...options },
      validator: {
        validate: (_value: unknown, args: ValidationArguments) => {
          const o = args.object as { to?: unknown; cc?: unknown; bcc?: unknown };
          return [o.to, o.cc, o.bcc].some(
            (field) => typeof field === 'string' && parseRecipientField(field).emails.length > 0,
          );
        },
      },
    });
  };
}
