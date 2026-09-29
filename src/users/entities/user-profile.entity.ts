import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { AppRole, UserStatus } from '../users.types';

/**
 * Perfil de un usuario de Corebio Mail. El id es el mismo de `auth.users`
 * (Supabase); la tabla se llama `user_profiles` para no confundirse con esa.
 * Ver la migración CreateUserProfiles para el trigger y el backfill.
 */
@Entity({ name: 'user_profiles' })
export class UserProfile {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'varchar', length: 16, default: 'user' })
  role: AppRole;

  @Column({ type: 'varchar', length: 16, default: 'invited' })
  status: UserStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
