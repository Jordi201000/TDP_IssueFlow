import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/enums/audit-action.enum';
import { AuditActor } from '../audit-log/enums/audit-actor.enum';
import { AuditEntityType } from '../audit-log/enums/audit-entity-type.enum';
import { AppConfig } from '../config/configuration';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';
import { RevokedTokenService } from './revoked-token.service';

export interface LoginResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditLogService,
    private readonly revokedTokens: RevokedTokenService,
  ) {}

  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.users.findByUsername(dto.username);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const expiresIn = this.config.get<AppConfig['jwt']>('jwt')!.ttlSeconds;
    const jti = randomUUID();
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, username: user.username, role: user.role, jti },
      { expiresIn },
    );

    await this.audit.record({
      action: AuditAction.LOGIN,
      entityType: AuditEntityType.USER,
      entityId: user.id,
      actor: AuditActor.USER,
      performedBy: user.id,
    });

    return { accessToken, tokenType: 'Bearer', expiresIn };
  }

  async logout(user: AuthenticatedUser): Promise<void> {
    this.revokedTokens.revoke(user.jti, user.exp);

    await this.audit.record({
      action: AuditAction.LOGOUT,
      entityType: AuditEntityType.USER,
      entityId: user.userId,
      actor: AuditActor.USER,
      performedBy: user.userId,
    });
  }
}
