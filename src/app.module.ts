import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { envValidationSchema } from './config/env.validation';
import { buildDataSourceOptions } from './database/typeorm.config';
import { DriveAccessModule } from './drive-access/drive-access.module';
import { HealthModule } from './health/health.module';
import { MailboxesModule } from './mailboxes/mailboxes.module';
import { MessagesModule } from './messages/messages.module';
import { ScheduledMessagesModule } from './scheduled-messages/scheduled-messages.module';
import { TemplatesModule } from './templates/templates.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        ...buildDataSourceOptions({
          url: config.getOrThrow<string>('DATABASE_URL'),
          ssl: config.getOrThrow<boolean>('DATABASE_SSL'),
          sslCa: config.get<string>('DATABASE_SSL_CA'),
        }),
        // Cada módulo registra sus entidades con TypeOrmModule.forFeature().
        autoLoadEntities: true,
      }),
    }),
    HealthModule,
    AuthModule,
    UsersModule,
    MailboxesModule,
    MessagesModule,
    ScheduledMessagesModule,
    TemplatesModule,
    DriveAccessModule,
  ],
})
export class AppModule {}
