import { ConfigService } from '@nestjs/config';
import { Role } from '../../common/enums/role.enum';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const config = {
    get: () => ({ secret: 'test-secret', ttlSeconds: 3600 }),
  } as unknown as ConfigService;
  const strategy = new JwtStrategy(config);

  it('validate maps payload.sub to userId and passes through username/role', () => {
    const result = strategy.validate({
      sub: 5,
      username: 'jdoe',
      role: Role.ADMIN,
    });
    expect(result).toEqual({
      userId: 5,
      username: 'jdoe',
      role: Role.ADMIN,
    });
  });
});
