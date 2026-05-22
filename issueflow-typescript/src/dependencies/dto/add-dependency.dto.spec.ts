import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AddDependencyDto } from './add-dependency.dto';

describe('AddDependencyDto', () => {
  it('accepts a valid positive integer', async () => {
    const dto = plainToInstance(AddDependencyDto, { blockedBy: 5 });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects missing blockedBy', async () => {
    const dto = plainToInstance(AddDependencyDto, {});
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('blockedBy');
  });

  it('rejects non-positive blockedBy', async () => {
    const dto = plainToInstance(AddDependencyDto, { blockedBy: 0 });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('blockedBy');
  });
});
