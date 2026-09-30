import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserProfile } from './entities/user-profile.entity';

/**
 * Fase 0: solo la lectura de perfiles que necesita el guard de autenticación.
 * Fase 2 suma el CRUD de admin (listar, invitar, permisos, desactivar, borrar).
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserProfile)
    private readonly profiles: Repository<UserProfile>,
  ) {}

  findProfileById(id: string): Promise<UserProfile | null> {
    return this.profiles.findOneBy({ id });
  }
}
