import { TicketPriority } from '../../common/enums/ticket-priority.enum';
import { TicketStatus } from '../../common/enums/ticket-status.enum';
import { TicketType } from '../../common/enums/ticket-type.enum';
import { Ticket } from '../entities/ticket.entity';
import {
  parseTicketCsv,
  serializeTicketsToCsv,
  TICKET_CSV_COLUMNS,
} from './ticket-csv';

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 1,
    title: 'T',
    description: 'd',
    status: TicketStatus.TODO,
    priority: TicketPriority.HIGH,
    type: TicketType.BUG,
    projectId: 1,
    assigneeId: null,
    ...overrides,
  } as Ticket;
}

describe('serializeTicketsToCsv', () => {
  it('emits the README-specified header row in column order', () => {
    const csv = serializeTicketsToCsv([]);
    expect(csv.trim()).toBe(TICKET_CSV_COLUMNS.join(','));
  });

  it('serializes simple rows', () => {
    const csv = serializeTicketsToCsv([ticket({ id: 1, title: 'Fix bug' })]);
    expect(csv).toContain('1,Fix bug,d,TODO,HIGH,BUG,');
  });

  it('quotes fields containing commas', () => {
    const csv = serializeTicketsToCsv([
      ticket({ id: 1, title: 'Fix, login bug' }),
    ]);
    expect(csv).toContain('"Fix, login bug"');
  });

  it('escapes embedded double quotes', () => {
    const csv = serializeTicketsToCsv([
      ticket({ id: 1, description: 'user said "hi"' }),
    ]);
    expect(csv).toContain('"user said ""hi"""');
  });

  it('emits empty string for null assigneeId', () => {
    const csv = serializeTicketsToCsv([ticket({ id: 1, assigneeId: null })]);
    expect(csv).toMatch(/BUG,\s*$/m);
  });
});

describe('parseTicketCsv', () => {
  it('parses simple rows with header', () => {
    const buf = Buffer.from(
      'id,title,description,status,priority,type,assigneeId\n,Fix bug,desc,TODO,HIGH,BUG,2\n',
    );
    const rows = parseTicketCsv(buf);
    expect(rows).toHaveLength(1);
    expect(rows[0].row).toBe(2);
    expect(rows[0].data.title).toBe('Fix bug');
    expect(rows[0].data.assigneeId).toBe('2');
  });

  it('roundtrips quoted commas and quotes', () => {
    const original = [ticket({ id: 1, title: 'Fix, "bug"', description: 'x' })];
    const csv = serializeTicketsToCsv(original);
    const rows = parseTicketCsv(Buffer.from(csv));
    expect(rows[0].data.title).toBe('Fix, "bug"');
  });

  it('handles BOM-prefixed input', () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const body = Buffer.from(
      'id,title,description,status,priority,type,assigneeId\n,t,d,TODO,LOW,BUG,\n',
    );
    const rows = parseTicketCsv(Buffer.concat([bom, body]));
    expect(rows[0].data.title).toBe('t');
  });

  it('skips empty lines', () => {
    const buf = Buffer.from(
      'id,title,description,status,priority,type,assigneeId\n,t1,d,TODO,LOW,BUG,\n\n,t2,d,TODO,LOW,BUG,\n',
    );
    expect(parseTicketCsv(buf)).toHaveLength(2);
  });

  it('throws on malformed CSV', () => {
    const buf = Buffer.from(
      'id,title,description,status,priority,type,assigneeId\n,"unterminated\n',
    );
    expect(() => parseTicketCsv(buf)).toThrow();
  });
});
