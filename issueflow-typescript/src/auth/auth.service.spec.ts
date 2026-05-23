import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { AuditLogService } from '../audit-log/audit-log.service';
import { Role } from '../common/enums/role.enum';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { RevokedTokenService } from './revoked-token.service';

describe('AuthService', () => {
  let service: AuthService;
  let users: jest.Mocked<Pick<UsersService, 'findByUsername'>>;
  let jwt: jest.Mocked<Pick<JwtService, 'signAsync'>>;
  let revokedTokens: jest.Mocked<Pick<RevokedTokenService, 'revoke'>>;

  const password = 'sup3rSecret';
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(password, 10);
  });

  beforeEach(async () => {
    users = { findByUsername: jest.fn() };
    jwt = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };
    revokedTokens = { revoke: jest.fn() };
    const config = {
      get: jest.fn().mockReturnValue({ secret: 's', ttlSeconds: 3600 }),
    };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: users },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: config },
        { provide: AuditLogService, useValue: { record: jest.fn() } },
        { provide: RevokedTokenService, useValue: revokedTokens },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  const validUser = {
    id: 7,
    username: 'jdoe',
    role: Role.DEVELOPER,
  } as User;

  it('returns token + ttl on valid credentials and signs the expected payload', async () => {
    users.findByUsername.mockResolvedValueOnce({ ...validUser, passwordHash } as User);
    const result = await service.login({ username: 'jdoe', password });

    expect(result).toEqual({
      accessToken: 'signed.jwt.token',
      tokenType: 'Bearer',
      expiresIn: 3600,
    });
    expect(jwt.signAsync).toHaveBeenCalledWith(
      {
        sub: 7,
        username: 'jdoe',
        role: Role.DEVELOPER,
        jti: expect.any(String),
      },
      { expiresIn: 3600 },
    );
  });

  it('revokes the presented token on logout', async () => {
    await service.logout({
      userId: 7,
      username: 'jdoe',
      role: Role.DEVELOPER,
      jti: 'token-id',
      exp: 12345,
    });

    expect(revokedTokens.revoke).toHaveBeenCalledWith('token-id', 12345);
  });

  it('throws UnauthorizedException with the same message on missing user', async () => {
    users.findByUsername.mockResolvedValueOnce(null);
    const err = await service.login({ username: 'nobody', password: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err.message).toBe('Invalid credentials');
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException with the same message on bad password', async () => {
    users.findByUsername.mockResolvedValueOnce({ ...validUser, passwordHash } as User);
    const err = await service
      .login({ username: 'jdoe', password: 'wrong' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err.message).toBe('Invalid credentials');
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });
});
