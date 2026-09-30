import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { trimString } from '../../common/transforms';

export class CreateMailboxDto {
  /** Se normaliza a minúsculas: Gmail no distingue mayúsculas en la dirección. */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'email tiene que ser un email válido' })
  @MaxLength(254)
  email: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'displayName no puede estar vacío' })
  @MaxLength(100)
  displayName: string;
}
