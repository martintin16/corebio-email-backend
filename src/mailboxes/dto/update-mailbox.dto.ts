import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { trimString } from '../../common/transforms';

/** Solo se puede cambiar el nombre visible; el email identifica la casilla. */
export class UpdateMailboxDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'displayName no puede estar vacío' })
  @MaxLength(100)
  displayName: string;
}
