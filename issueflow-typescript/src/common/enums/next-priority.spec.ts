import { TicketPriority, nextPriority } from './ticket-priority.enum';

describe('nextPriority', () => {
  it.each([
    [TicketPriority.LOW, TicketPriority.MEDIUM],
    [TicketPriority.MEDIUM, TicketPriority.HIGH],
    [TicketPriority.HIGH, TicketPriority.CRITICAL],
    [TicketPriority.CRITICAL, TicketPriority.CRITICAL],
  ])('%s -> %s', (from, to) => {
    expect(nextPriority(from)).toBe(to);
  });
});
