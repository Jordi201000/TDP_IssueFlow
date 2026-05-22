export enum TicketStatus {
  TODO = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  IN_REVIEW = 'IN_REVIEW',
  DONE = 'DONE',
}

export const TICKET_STATUS_ORDER: TicketStatus[] = [
  TicketStatus.TODO,
  TicketStatus.IN_PROGRESS,
  TicketStatus.IN_REVIEW,
  TicketStatus.DONE,
];

export function isForwardOrSame(from: TicketStatus, to: TicketStatus): boolean {
  return TICKET_STATUS_ORDER.indexOf(to) >= TICKET_STATUS_ORDER.indexOf(from);
}
