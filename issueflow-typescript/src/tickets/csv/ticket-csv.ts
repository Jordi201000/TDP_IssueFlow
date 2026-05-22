import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { Ticket } from '../entities/ticket.entity';

export interface CsvParseRow {
  row: number;
  data: Record<string, string>;
}

export interface ImportSummary {
  created: number;
  failed: number;
  errors: Array<{ row: number; message: string }>;
}

export const TICKET_CSV_COLUMNS = [
  'id',
  'title',
  'description',
  'status',
  'priority',
  'type',
  'assigneeId',
];

export function serializeTicketsToCsv(tickets: Ticket[]): string {
  const rows = tickets.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    type: t.type,
    assigneeId: t.assigneeId ?? '',
  }));
  return stringify(rows, { header: true, columns: TICKET_CSV_COLUMNS });
}

export function parseTicketCsv(buffer: Buffer): CsvParseRow[] {
  const text = buffer.toString('utf-8');
  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as Record<string, string>[];
  // Row index: header is row 1, first data row is row 2.
  return records.map((data, i) => ({ row: i + 2, data }));
}
