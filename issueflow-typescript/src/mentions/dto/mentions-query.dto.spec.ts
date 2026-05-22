import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MentionsQueryDto } from './mentions-query.dto';

describe('MentionsQueryDto', () => {
  it('accepts empty query (defaults applied at usage site)', async () => {
    const dto = plainToInstance(MentionsQueryDto, {});
    expect(await validate(dto)).toHaveLength(0);
  });

  it('coerces string page/pageSize to integers', async () => {
    const dto = plainToInstance(MentionsQueryDto, {
      page: '2',
      pageSize: '50',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.pageSize).toBe(50);
  });

  it('rejects pageSize > 100', async () => {
    const dto = plainToInstance(MentionsQueryDto, { pageSize: '101' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('pageSize');
  });

  it('rejects non-positive page', async () => {
    const dto = plainToInstance(MentionsQueryDto, { page: '0' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('page');
  });
});
