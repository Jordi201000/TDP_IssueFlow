import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../common/enums/role.enum';
import { TicketStatus } from '../common/enums/ticket-status.enum';
import { Project } from '../projects/entities/project.entity';
import { Ticket } from '../tickets/entities/ticket.entity';
import { User } from '../users/entities/user.entity';
import { WorkloadService } from './workload.service';

function makeRepo<T>(): jest.Mocked<Repository<T>> {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

describe('WorkloadService', () => {
  let service: WorkloadService;
  let projects: jest.Mocked<Repository<Project>>;
  let tickets: jest.Mocked<Repository<Ticket>>;
  let users: jest.Mocked<Repository<User>>;

  beforeEach(async () => {
    projects = makeRepo<Project>();
    tickets = makeRepo<Ticket>();
    users = makeRepo<User>();
    const module = await Test.createTestingModule({
      providers: [
        WorkloadService,
        { provide: getRepositoryToken(Project), useValue: projects },
        { provide: getRepositoryToken(Ticket), useValue: tickets },
        { provide: getRepositoryToken(User), useValue: users },
      ],
    }).compile();
    service = module.get(WorkloadService);
  });

  describe('getMemberIds', () => {
    it('returns [] when project missing', async () => {
      projects.findOne.mockResolvedValueOnce(null);
      await expect(service.getMemberIds(99)).resolves.toEqual([]);
    });

    it('returns just owner when no tickets exist', async () => {
      projects.findOne.mockResolvedValueOnce({ id: 1, ownerId: 5 } as Project);
      tickets.find.mockResolvedValueOnce([]);
      await expect(service.getMemberIds(1)).resolves.toEqual([5]);
    });

    it('unions owner with DISTINCT non-null ticket assignees', async () => {
      projects.findOne.mockResolvedValueOnce({ id: 1, ownerId: 5 } as Project);
      tickets.find.mockResolvedValueOnce([
        { assigneeId: 5 } as Ticket,
        { assigneeId: 7 } as Ticket,
        { assigneeId: 7 } as Ticket,
      ]);
      const result = await service.getMemberIds(1);
      expect(result.sort()).toEqual([5, 7]);
    });
  });

  describe('pickAutoAssignee', () => {
    it('returns null when no DEVELOPER members', async () => {
      projects.findOne.mockResolvedValueOnce({ id: 1, ownerId: 5 } as Project);
      tickets.find.mockResolvedValueOnce([]);
      users.find.mockResolvedValueOnce([]); // none with DEVELOPER role
      await expect(service.pickAutoAssignee(1)).resolves.toBeNull();
    });

    it('returns the only dev when one exists', async () => {
      projects.findOne.mockResolvedValueOnce({ id: 1, ownerId: 5 } as Project);
      tickets.find.mockResolvedValueOnce([]);
      users.find.mockResolvedValueOnce([
        { id: 5, role: Role.DEVELOPER } as User,
      ]);
      tickets.find.mockResolvedValueOnce([]); // no open tickets
      await expect(service.pickAutoAssignee(1)).resolves.toBe(5);
    });

    it('picks the dev with the lowest open-ticket count', async () => {
      projects.findOne.mockResolvedValueOnce({ id: 1, ownerId: 5 } as Project);
      tickets.find.mockResolvedValueOnce([
        { assigneeId: 7 } as Ticket,
      ]);
      users.find.mockResolvedValueOnce([
        { id: 5, role: Role.DEVELOPER } as User,
        { id: 7, role: Role.DEVELOPER } as User,
      ]);
      tickets.find.mockResolvedValueOnce([
        { assigneeId: 5, status: TicketStatus.IN_PROGRESS } as Ticket,
        { assigneeId: 5, status: TicketStatus.TODO } as Ticket,
        { assigneeId: 7, status: TicketStatus.TODO } as Ticket,
      ]);
      // 5 has 2 open, 7 has 1 → pick 7
      await expect(service.pickAutoAssignee(1)).resolves.toBe(7);
    });

    it('tie-breaks by oldest registration (lowest user id)', async () => {
      projects.findOne.mockResolvedValueOnce({ id: 1, ownerId: 5 } as Project);
      tickets.find.mockResolvedValueOnce([
        { assigneeId: 7 } as Ticket,
        { assigneeId: 9 } as Ticket,
      ]);
      users.find.mockResolvedValueOnce([
        { id: 5, role: Role.DEVELOPER } as User,
        { id: 7, role: Role.DEVELOPER } as User,
        { id: 9, role: Role.DEVELOPER } as User,
      ]);
      tickets.find.mockResolvedValueOnce([]); // all have 0 open → tie
      await expect(service.pickAutoAssignee(1)).resolves.toBe(5);
    });

    it('ignores ADMIN members', async () => {
      projects.findOne.mockResolvedValueOnce({ id: 1, ownerId: 5 } as Project);
      tickets.find.mockResolvedValueOnce([
        { assigneeId: 7 } as Ticket,
      ]);
      // users.find filters to DEVELOPER role, returns only the dev (7), not admin owner (5)
      users.find.mockResolvedValueOnce([
        { id: 7, role: Role.DEVELOPER } as User,
      ]);
      tickets.find.mockResolvedValueOnce([]);
      await expect(service.pickAutoAssignee(1)).resolves.toBe(7);
    });
  });

  describe('getWorkload', () => {
    it('throws NotFoundException on missing project', async () => {
      projects.findOne.mockResolvedValueOnce(null);
      await expect(service.getWorkload(99)).rejects.toThrow(NotFoundException);
    });

    it('includes ADMIN + DEVELOPER members, sorted by openTicketCount ASC', async () => {
      projects.findOne.mockResolvedValueOnce({ id: 1, ownerId: 5 } as Project);
      // getMemberIds:
      projects.findOne.mockResolvedValueOnce({ id: 1, ownerId: 5 } as Project);
      tickets.find.mockResolvedValueOnce([
        { assigneeId: 7 } as Ticket,
      ]);
      // users.find for getWorkload (all members, no role filter)
      users.find.mockResolvedValueOnce([
        { id: 5, username: 'admin', role: Role.ADMIN } as User,
        { id: 7, username: 'dev', role: Role.DEVELOPER } as User,
      ]);
      tickets.find.mockResolvedValueOnce([
        { assigneeId: 7, status: TicketStatus.TODO } as Ticket,
        { assigneeId: 7, status: TicketStatus.IN_PROGRESS } as Ticket,
      ]);

      const result = await service.getWorkload(1);
      expect(result).toEqual([
        { userId: 5, username: 'admin', openTicketCount: 0 },
        { userId: 7, username: 'dev', openTicketCount: 2 },
      ]);
    });

    it('returns [] when project has no members (defensive)', async () => {
      // getWorkload's own project lookup OK
      projects.findOne.mockResolvedValueOnce({ id: 1, ownerId: 5 } as Project);
      // getMemberIds: project missing on its inner lookup → returns []
      projects.findOne.mockResolvedValueOnce(null);
      await expect(service.getWorkload(1)).resolves.toEqual([]);
    });
  });
});
