import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TicketPriority } from '../../common/enums/ticket-priority.enum';
import { TicketStatus } from '../../common/enums/ticket-status.enum';
import { TicketType } from '../../common/enums/ticket-type.enum';
import { CreateTicketDto } from './create-ticket.dto';

describe('CreateTicketDto', () => {
  const base = {
    title: 'Fix login bug',
    description: 'Users can’t log in on mobile',
    status: TicketStatus.TODO,
    priority: TicketPriority.HIGH,
    type: TicketType.BUG,
    projectId: 1,
  };

  async function errorsFor(overrides: Record<string, unknown>) {
    const dto = plainToInstance(CreateTicketDto, { ...base, ...overrides });
    return validate(dto);
  }

  it('accepts a valid full payload', async () => {
    const errors = await errorsFor({
      assigneeId: 2,
      dueDate: '2026-08-01T00:00:00Z',
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts a payload without optional assigneeId / dueDate', async () => {
    expect(await errorsFor({})).toHaveLength(0);
  });

  it.each([
    ['status', { status: 'BOGUS' }],
    ['priority', { priority: 'URGENT' }],
    ['type', { type: 'STORY' }],
  ])('rejects invalid %s value', async (field, override) => {
    const errors = await errorsFor(override);
    expect(errors.map((e) => e.property)).toContain(field);
  });

  it('rejects missing title', async () => {
    const dto = plainToInstance(CreateTicketDto, {
      description: 'x',
      status: TicketStatus.TODO,
      priority: TicketPriority.HIGH,
      type: TicketType.BUG,
      projectId: 1,
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('title');
  });

  it('rejects non-ISO dueDate', async () => {
    const errors = await errorsFor({ dueDate: 'tomorrow' });
    expect(errors.map((e) => e.property)).toContain('dueDate');
  });
});
