import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCommentDto } from './create-comment.dto';

describe('CreateCommentDto', () => {
  it('accepts a valid payload', async () => {
    const dto = plainToInstance(CreateCommentDto, {
      authorId: 1,
      content: 'Hello world',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects missing authorId', async () => {
    const dto = plainToInstance(CreateCommentDto, { content: 'x' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('authorId');
  });

  it('rejects non-positive authorId', async () => {
    const dto = plainToInstance(CreateCommentDto, {
      authorId: 0,
      content: 'x',
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('authorId');
  });

  it('rejects empty content', async () => {
    const dto = plainToInstance(CreateCommentDto, {
      authorId: 1,
      content: '',
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('content');
  });

  it('rejects content over 5000 chars', async () => {
    const dto = plainToInstance(CreateCommentDto, {
      authorId: 1,
      content: 'x'.repeat(5001),
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('content');
  });
});
