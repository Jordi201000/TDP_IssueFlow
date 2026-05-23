import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { Role } from '../../common/enums/role.enum';
import { User } from '../../users/entities/user.entity';
import { UsersService } from '../../users/users.service';
import { RevokedTokenService } from '../revoked-token.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let revokedTokens: jest.Mocked<Pick<RevokedTokenService, 'isRevoked'>>;
  let users: jest.Mocked<Pick<UsersService, 'findOne'>>;
  let strategy: JwtStrategy;

  beforeEach(() => {
    const config = {
      get: () => ({ secret: 'test-secret', ttlSeconds: 3600 }),
    } as unknown as ConfigService;
    revokedTokens = {
      isRevoked: jest.fn().mockReturnValue(false),
    };
    users = {
      findOne: jest.fn().mockResolvedValue({
        id: 5,
        username: 'current-name',
        role: Role.DEVELOPER,
      } as User),
    };
    strategy = new JwtStrategy(
      config,
      revokedTokens as unknown as RevokedTokenService,
      users as unknown as UsersService,
    );
  });

  it('validate maps payload.sub to an existing current user', async () => {
    const result = await strategy.validate({
      sub: 5,
      username: 'stale-name',
      role: Role.ADMIN,
      jti: 'token-id',
      exp: 12345,
    });
    expect(result).toEqual({
      userId: 5,
      username: 'current-name',
      role: Role.DEVELOPER,
      jti: 'token-id',
      exp: 12345,
    });
    expect(users.findOne).toHaveBeenCalledWith(5);
  });

  it('rejects revoked tokens', async () => {
    revokedTokens.isRevoked.mockReturnValueOnce(true);

    await expect(
      strategy.validate({
        sub: 5,
        username: 'jdoe',
        role: Role.ADMIN,
        jti: 'token-id',
        exp: 12345,
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects tokens for deleted users', async () => {
    users.findOne.mockRejectedValueOnce(new Error('not found'));

    await expect(
      strategy.validate({
        sub: 5,
        username: 'jdoe',
        role: Role.ADMIN,
        jti: 'token-id',
        exp: 12345,
      }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
