import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { Role } from '../../common/enums/role.enum';
import { RevokedTokenService } from '../revoked-token.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const config = {
    get: () => ({ secret: 'test-secret', ttlSeconds: 3600 }),
  } as unknown as ConfigService;
  const revokedTokens = {
    isRevoked: jest.fn().mockReturnValue(false),
  } as unknown as jest.Mocked<Pick<RevokedTokenService, 'isRevoked'>>;
  const strategy = new JwtStrategy(
    config,
    revokedTokens as unknown as RevokedTokenService,
  );

  it('validate maps payload.sub to userId and passes through username/role', () => {
    const result = strategy.validate({
      sub: 5,
      username: 'jdoe',
      role: Role.ADMIN,
      jti: 'token-id',
      exp: 12345,
    });
    expect(result).toEqual({
      userId: 5,
      username: 'jdoe',
      role: Role.ADMIN,
      jti: 'token-id',
      exp: 12345,
    });
  });

  it('rejects revoked tokens', () => {
    revokedTokens.isRevoked.mockReturnValueOnce(true);

    expect(() =>
      strategy.validate({
        sub: 5,
        username: 'jdoe',
        role: Role.ADMIN,
        jti: 'token-id',
        exp: 12345,
      }),
    ).toThrow(UnauthorizedException);
  });
});
