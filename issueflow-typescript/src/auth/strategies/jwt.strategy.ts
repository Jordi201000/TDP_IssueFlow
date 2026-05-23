import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfig } from '../../config/configuration';
import { Role } from '../../common/enums/role.enum';
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
  ) {
    const jwt = config.get<AppConfig['jwt']>('jwt');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwt?.secret ?? 'change-me-in-prod',
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    if (!payload.jti || this.revokedTokens.isRevoked(payload.jti)) {
      throw new UnauthorizedException('Token has been revoked');
    }
    return {
      userId: payload.sub,
      username: payload.username,
      role: payload.role,
      jti: payload.jti,
      exp: payload.exp,
    };
  }
}
