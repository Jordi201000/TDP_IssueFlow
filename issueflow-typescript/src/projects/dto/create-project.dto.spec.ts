import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProjectDto } from './create-project.dto';

describe('CreateProjectDto', () => {
  const base = {
    name: 'Sample Project',
    description: 'A sample project',
    ownerId: 1,
  };

  async function errorsFor(overrides: Partial<typeof base> | Record<string, unknown>) {
    const dto = plainToInstance(CreateProjectDto, { ...base, ...overrides });
    return validate(dto);
  }

  it('accepts a valid payload', async () => {
    expect(await errorsFor({})).toHaveLength(0);
  });

  it('rejects missing name', async () => {
    const dto = plainToInstance(CreateProjectDto, {
      description: 'desc',
      ownerId: 1,
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('name');
  });

  it('rejects missing description', async () => {
    const dto = plainToInstance(CreateProjectDto, {
      name: 'x',
      ownerId: 1,
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('description');
  });

  it('rejects non-integer ownerId (string)', async () => {
    const errors = await errorsFor({ ownerId: 'one' as unknown as number });
    expect(errors.map((e) => e.property)).toContain('ownerId');
  });

  it('rejects non-positive ownerId', async () => {
    const errors = await errorsFor({ ownerId: 0 });
    expect(errors.map((e) => e.property)).toContain('ownerId');
  });
});
