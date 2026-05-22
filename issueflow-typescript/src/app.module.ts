import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { AttachmentsModule } from './attachments/attachments.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { CommentsModule } from './comments/comments.module';
import { configuration, AppConfig } from './config/configuration';
import { DependenciesModule } from './dependencies/dependencies.module';
import { EscalationModule } from './escalation/escalation.module';
import { MentionsModule } from './mentions/mentions.module';
import { HealthModule } from './health/health.module';
import { ProjectsModule } from './projects/projects.module';
import { TicketsModule } from './tickets/tickets.module';
import { UsersModule } from './users/users.module';

function buildTypeOrmOptions(config: ConfigService): TypeOrmModuleOptions {
  const nodeEnv = config.get<AppConfig['nodeEnv']>('nodeEnv');

  if (nodeEnv === 'test') {
    return {
      type: 'better-sqlite3',
      database: ':memory:',
      dropSchema: true,
      synchronize: true,
      autoLoadEntities: true,
    };
  }

  const db = config.get<AppConfig['db']>('db')!;
  return {
    type: 'postgres',
    host: db.host,
    port: db.port,
    username: db.user,
    password: db.pass,
    database: db.name,
    synchronize: true,
    autoLoadEntities: true,
  };
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: buildTypeOrmOptions,
    }),
    HealthModule,
    UsersModule,
    AuthModule,
    ProjectsModule,
    TicketsModule,
    CommentsModule,
    AuditLogModule,
    DependenciesModule,
    AttachmentsModule,
    MentionsModule,
    EscalationModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
