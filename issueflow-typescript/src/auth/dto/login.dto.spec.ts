import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from './login.dto';

describe('LoginDto', () => {
  it('accepts a valid payload', async () => {
    const dto = plainToInstance(LoginDto, { username: 'jdoe', password: 'secret' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects missing username', async () => {
    const dto = plainToInstance(LoginDto, { password: 'secret' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('username');
  });

  it('rejects missing password', async () => {
    const dto = plainToInstance(LoginDto, { username: 'jdoe' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('password');
  });
});
