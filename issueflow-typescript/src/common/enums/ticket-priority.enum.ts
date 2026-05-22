export enum TicketPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export const PRIORITY_ORDER: TicketPriority[] = [
  TicketPriority.LOW,
  TicketPriority.MEDIUM,
  TicketPriority.HIGH,
  TicketPriority.CRITICAL,
];

/** Returns the next priority level toward CRITICAL, or CRITICAL itself if already there. */
export function nextPriority(p: TicketPriority): TicketPriority {
  const i = PRIORITY_ORDER.indexOf(p);
  if (i < 0 || i >= PRIORITY_ORDER.length - 1) return TicketPriority.CRITICAL;
  return PRIORITY_ORDER[i + 1];
}
