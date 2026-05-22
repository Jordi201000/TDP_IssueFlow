import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/enums/audit-action.enum';
import { AuditActor } from '../audit-log/enums/audit-actor.enum';
import { AuditEntityType } from '../audit-log/enums/audit-entity-type.enum';
import { TicketStatus } from '../common/enums/ticket-status.enum';
import { Ticket } from '../tickets/entities/ticket.entity';
import { TicketsService } from '../tickets/tickets.service';
import { DependenciesService } from './dependencies.service';
import { TicketDependency } from './entities/ticket-dependency.entity';

function makeRepo(): jest.Mocked<Repository<TicketDependency>> {
  return {
    create: jest.fn((data: Partial<TicketDependency>) => ({ ...data }) as TicketDependency),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
  } as unknown as jest.Mocked<Repository<TicketDependency>>;
}

describe('DependenciesService', () => {
  let service: DependenciesService;
  let repo: jest.Mocked<Repository<TicketDependency>>;
  let tickets: jest.Mocked<Pick<TicketsService, 'findOne'>>;
  let audit: { record: jest.Mock };

  beforeEach(async () => {
    repo = makeRepo();
    tickets = { findOne: jest.fn() };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [
        DependenciesService,
        { provide: getRepositoryToken(TicketDependency), useValue: repo },
        { provide: TicketsService, useValue: tickets },
        { provide: AuditLogService, useValue: audit },
      ],
    }).compile();
    service = module.get(DependenciesService);
  });

  function ticket(id: number, overrides: Partial<Ticket> = {}): Ticket {
    return {
      id,
      title: `Ticket ${id}`,
      status: TicketStatus.IN_PROGRESS,
      projectId: 1,
      ...overrides,
    } as Ticket;
  }

  describe('add', () => {
    it('inserts and emits audit on happy path', async () => {
      tickets.findOne.mockResolvedValueOnce(ticket(1));
      tickets.findOne.mockResolvedValueOnce(ticket(2));
      repo.findOne.mockResolvedValueOnce(null); // not yet linked
      repo.find.mockResolvedValue([]); // no cycle

      await service.add(1, 2, {
        actor: AuditActor.USER,
        performedBy: 99,
      });

      expect(repo.save).toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.CREATE,
          entityType: AuditEntityType.TICKET_DEPENDENCY,
          entityId: 1,
          performedBy: 99,
          payload: { blockerId: 2 },
        }),
      );
    });

    it('rejects self-dependency', async () => {
      await expect(service.add(1, 1)).rejects.toThrow(BadRequestException);
      expect(tickets.findOne).not.toHaveBeenCalled();
    });

    it('rejects when ticket missing (propagates 404 from TicketsService)', async () => {
      tickets.findOne.mockRejectedValueOnce(new NotFoundException());
      await expect(service.add(1, 2)).rejects.toThrow(NotFoundException);
    });

    it('rejects cross-project pair', async () => {
      tickets.findOne.mockResolvedValueOnce(ticket(1, { projectId: 1 }));
      tickets.findOne.mockResolvedValueOnce(ticket(2, { projectId: 2 }));
      const err = await service.add(1, 2).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toMatch(/different projects/);
    });

    it('idempotent when edge already exists', async () => {
      tickets.findOne.mockResolvedValueOnce(ticket(1));
      tickets.findOne.mockResolvedValueOnce(ticket(2));
      repo.findOne.mockResolvedValueOnce({
        ticketId: 1,
        blockerId: 2,
      } as TicketDependency);

      await service.add(1, 2, { actor: AuditActor.USER, performedBy: 99 });

      expect(repo.save).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('rejects when adding would create a cycle', async () => {
      tickets.findOne.mockResolvedValueOnce(ticket(1));
      tickets.findOne.mockResolvedValueOnce(ticket(2));
      repo.findOne.mockResolvedValueOnce(null);
      // Cycle detection DFS from blockerId=2:
      //   blockers of 2 = [1]  →  reaches ticketId=1 → cycle
      repo.find.mockImplementation(async ({ where }) => {
        const w = where as { ticketId: number };
        if (w.ticketId === 2) return [{ ticketId: 2, blockerId: 1 } as TicketDependency];
        return [];
      });

      const err = await service.add(1, 2).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toMatch(/cycle/);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('listBlockers', () => {
    it('returns slim shape { id, title, status }', async () => {
      tickets.findOne.mockResolvedValueOnce(ticket(1));
      repo.find.mockResolvedValueOnce([
        { ticketId: 1, blockerId: 2 } as TicketDependency,
      ]);
      tickets.findOne.mockResolvedValueOnce(
        ticket(2, { title: 'Blocker', status: TicketStatus.IN_REVIEW }),
      );

      await expect(service.listBlockers(1)).resolves.toEqual([
        { id: 2, title: 'Blocker', status: TicketStatus.IN_REVIEW },
      ]);
    });

    it('throws NotFound when ticket missing', async () => {
      tickets.findOne.mockRejectedValueOnce(new NotFoundException());
      await expect(service.listBlockers(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes and emits audit on happy path', async () => {
      repo.delete.mockResolvedValueOnce({ affected: 1, raw: {} } as never);
      await service.remove(1, 2, { actor: AuditActor.USER, performedBy: 99 });
      expect(repo.delete).toHaveBeenCalledWith({ ticketId: 1, blockerId: 2 });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.DELETE,
          entityType: AuditEntityType.TICKET_DEPENDENCY,
          entityId: 1,
          payload: { blockerId: 2 },
        }),
      );
    });

    it('throws NotFound when edge missing', async () => {
      repo.delete.mockResolvedValueOnce({ affected: 0, raw: {} } as never);
      await expect(service.remove(1, 2)).rejects.toThrow(NotFoundException);
    });
  });
});
