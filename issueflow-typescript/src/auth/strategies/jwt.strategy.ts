import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfig } from '../../config/configuration';
import { Role } from '../../common/enums/role.enum';
import { UsersService } from '../../users/users.service';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { RevokedTokenService } from '../revoked-token.service';

interface JwtPayload {
  sub: number;
  username: string;
  role: Role;
  jti: string;
  exp: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly revokedTokens: RevokedTokenService,
    private readonly users: UsersService,
  ) {
    const jwt = config.get<AppConfig['jwt']>('jwt');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwt?.secret ?? 'change-me-in-prod',
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (!payload.jti || this.revokedTokens.isRevoked(payload.jti)) {
      throw new UnauthorizedException('Token has been revoked');
    }

    const user = await this.users.findOne(payload.sub).catch(() => null);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    return {
      userId: user.id,
      username: user.username,
      role: user.role,
      jti: payload.jti,
      exp: payload.exp,
    };
  }
}
