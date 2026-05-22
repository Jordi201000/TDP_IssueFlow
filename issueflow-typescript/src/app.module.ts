import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { configuration, AppConfig } from './config/configuration';
import { HealthModule } from './health/health.module';
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
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: buildTypeOrmOptions,
    }),
    HealthModule,
    UsersModule,
    AuthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
