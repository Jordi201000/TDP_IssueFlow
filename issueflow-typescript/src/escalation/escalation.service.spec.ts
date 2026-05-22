import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/enums/audit-action.enum';
import { AuditActor } from '../audit-log/enums/audit-actor.enum';
import { AuditEntityType } from '../audit-log/enums/audit-entity-type.enum';
import { TicketPriority } from '../common/enums/ticket-priority.enum';
import { TicketStatus } from '../common/enums/ticket-status.enum';
import { Ticket } from '../tickets/entities/ticket.entity';
import { EscalationService } from './escalation.service';

function makeRepo(): jest.Mocked<Repository<Ticket>> {
  return {
    find: jest.fn(),
    save: jest.fn(),
  } as unknown as jest.Mocked<Repository<Ticket>>;
}

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 1,
    title: 'T',
    description: 'd',
    status: TicketStatus.IN_PROGRESS,
    priority: TicketPriority.LOW,
    type: 'BUG' as never,
    projectId: 1,
    assigneeId: null,
    dueDate: new Date('2024-01-01'),
    isOverdue: false,
    version: 1,
    ...overrides,
  } as Ticket;
}

describe('EscalationService', () => {
  let service: EscalationService;
  let repo: jest.Mocked<Repository<Ticket>>;
  let audit: { record: jest.Mock };

  beforeEach(async () => {
    repo = makeRepo();
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [
        EscalationService,
        { provide: getRepositoryToken(Ticket), useValue: repo },
        { provide: AuditLogService, useValue: audit },
      ],
    }).compile();
    service = module.get(EscalationService);
  });

  it('returns {scanned:0, escalated:0} and does nothing when no overdue tickets', async () => {
    repo.find.mockResolvedValueOnce([]);
    await expect(service.runEscalation()).resolves.toEqual({
      scanned: 0,
      escalated: 0,
    });
    expect(repo.save).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('bumps LOW → MEDIUM and audits with {from, to}', async () => {
    const t = ticket({ id: 7, priority: TicketPriority.LOW });
    repo.find.mockResolvedValueOnce([t]);
    repo.save.mockImplementation(async (saved) => saved as Ticket);

    const result = await service.runEscalation();

    expect(t.priority).toBe(TicketPriority.MEDIUM);
    expect(result).toEqual({ scanned: 1, escalated: 1 });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.AUTO_ESCALATE,
        entityType: AuditEntityType.TICKET,
        entityId: 7,
        actor: AuditActor.SYSTEM,
        performedBy: null,
        payload: { from: TicketPriority.LOW, to: TicketPriority.MEDIUM },
      }),
    );
  });

  it('bumps HIGH → CRITICAL', async () => {
    const t = ticket({ id: 8, priority: TicketPriority.HIGH });
    repo.find.mockResolvedValueOnce([t]);
    repo.save.mockImplementation(async (s) => s as Ticket);

    await service.runEscalation();
    expect(t.priority).toBe(TicketPriority.CRITICAL);
    expect(t.isOverdue).toBe(false); // bump doesn't flip the flag
  });

  it('sets isOverdue=true on CRITICAL not yet flagged + audits', async () => {
    const t = ticket({
      id: 9,
      priority: TicketPriority.CRITICAL,
      isOverdue: false,
    });
    repo.find.mockResolvedValueOnce([t]);
    repo.save.mockImplementation(async (s) => s as Ticket);

    const result = await service.runEscalation();

    expect(t.isOverdue).toBe(true);
    expect(t.priority).toBe(TicketPriority.CRITICAL);
    expect(result).toEqual({ scanned: 1, escalated: 1 });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.AUTO_ESCALATE,
        entityId: 9,
        payload: { priority: TicketPriority.CRITICAL, isOverdue: true },
      }),
    );
  });

  it('CRITICAL with isOverdue=true → no-op (idempotent)', async () => {
    const t = ticket({
      id: 10,
      priority: TicketPriority.CRITICAL,
      isOverdue: true,
    });
    repo.find.mockResolvedValueOnce([t]);

    const result = await service.runEscalation();
    expect(result).toEqual({ scanned: 1, escalated: 0 });
    expect(repo.save).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('handles a mixed batch (bump + flag + no-op)', async () => {
    const a = ticket({ id: 1, priority: TicketPriority.LOW });
    const b = ticket({
      id: 2,
      priority: TicketPriority.CRITICAL,
      isOverdue: false,
    });
    const c = ticket({
      id: 3,
      priority: TicketPriority.CRITICAL,
      isOverdue: true,
    });
    repo.find.mockResolvedValueOnce([a, b, c]);
    repo.save.mockImplementation(async (s) => s as Ticket);

    const result = await service.runEscalation();
    expect(result).toEqual({ scanned: 3, escalated: 2 });
    expect(a.priority).toBe(TicketPriority.MEDIUM);
    expect(b.isOverdue).toBe(true);
    expect(audit.record).toHaveBeenCalledTimes(2);
  });
});
