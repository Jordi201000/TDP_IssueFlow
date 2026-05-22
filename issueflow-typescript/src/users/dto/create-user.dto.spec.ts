import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Role } from '../../common/enums/role.enum';
import { CreateUserDto } from './create-user.dto';

describe('CreateUserDto', () => {
  const base = {
    username: 'jdoe',
    email: 'jdoe@example.com',
    fullName: 'John Doe',
    role: Role.DEVELOPER,
    password: 'sup3rSecret',
  };

  async function errorsFor(overrides: Partial<typeof base>) {
    const dto = plainToInstance(CreateUserDto, { ...base, ...overrides });
    return validate(dto);
  }

  it('accepts a valid payload', async () => {
    expect(await errorsFor({})).toHaveLength(0);
  });

  it('rejects an invalid role', async () => {
    const errors = await errorsFor({ role: 'GUEST' as Role });
    expect(errors.map((e) => e.property)).toContain('role');
  });

  it('rejects a short password', async () => {
    const errors = await errorsFor({ password: 'short1' });
    const passwordErr = errors.find((e) => e.property === 'password');
    expect(passwordErr?.constraints).toHaveProperty('minLength');
  });

  it('rejects an invalid email', async () => {
    const errors = await errorsFor({ email: 'not-an-email' });
    expect(errors.map((e) => e.property)).toContain('email');
  });

  it('rejects a username with invalid characters', async () => {
    const errors = await errorsFor({ username: 'has space' });
    expect(errors.map((e) => e.property)).toContain('username');
  });
});
