import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PreconditionRequiredException } from '../common/exceptions/precondition-required.exception';
import { TicketPriority } from '../common/enums/ticket-priority.enum';
import { TicketStatus } from '../common/enums/ticket-status.enum';
import { TicketType } from '../common/enums/ticket-type.enum';
import { Project } from '../projects/entities/project.entity';
import { ProjectsService } from '../projects/projects.service';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { Ticket } from './entities/ticket.entity';
import { TicketsService } from './tickets.service';

function makeRepo(): jest.Mocked<Repository<Ticket>> {
  return {
    create: jest.fn((data: Partial<Ticket>) => ({ ...data }) as Ticket),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    softDelete: jest.fn(),
  } as unknown as jest.Mocked<Repository<Ticket>>;
}

describe('TicketsService', () => {
  let service: TicketsService;
  let repo: jest.Mocked<Repository<Ticket>>;
  let projects: jest.Mocked<Pick<ProjectsService, 'findOne'>>;
  let users: jest.Mocked<Pick<UsersService, 'findOne'>>;

  const validDto: CreateTicketDto = {
    title: 'Fix login bug',
    description: 'Users cannot log in on mobile',
    status: TicketStatus.TODO,
    priority: TicketPriority.HIGH,
    type: TicketType.BUG,
    projectId: 1,
  };

  beforeEach(async () => {
    repo = makeRepo();
    projects = { findOne: jest.fn() };
    users = { findOne: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: getRepositoryToken(Ticket), useValue: repo },
        { provide: ProjectsService, useValue: projects },
        { provide: UsersService, useValue: users },
      ],
    }).compile();

    service = module.get(TicketsService);
  });

  describe('create', () => {
    it('persists with defaults when assigneeId/dueDate omitted', async () => {
      projects.findOne.mockResolvedValueOnce({ id: 1 } as Project);
      repo.save.mockImplementation(async (t) => ({
        ...(t as Ticket),
        id: 1,
        version: 1,
      }));

      const result = await service.create(validDto);

      expect(result.id).toBe(1);
      expect(result.assigneeId).toBeNull();
      expect(result.dueDate).toBeNull();
      expect(result.isOverdue).toBe(false);
    });

    it('throws BadRequestException when project does not exist', async () => {
      projects.findOne.mockRejectedValueOnce(new NotFoundException());
      const err = await service.create(validDto).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toMatch(/Project 1 does not exist/);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when explicit assigneeId does not exist', async () => {
      projects.findOne.mockResolvedValueOnce({ id: 1 } as Project);
      users.findOne.mockRejectedValueOnce(new NotFoundException());
      const err = await service
        .create({ ...validDto, assigneeId: 99 })
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toMatch(/Assignee user 99 does not exist/);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('findAllByProject / findOne', () => {
    it('findAllByProject filters by projectId', async () => {
      repo.find.mockResolvedValueOnce([{ id: 1 } as Ticket]);
      await service.findAllByProject(7);
      expect(repo.find).toHaveBeenCalledWith({ where: { projectId: 7 } });
    });

    it('findOne returns when present', async () => {
      const t = { id: 5 } as Ticket;
      repo.findOne.mockResolvedValueOnce(t);
      await expect(service.findOne(5)).resolves.toBe(t);
    });

    it('findOne throws NotFoundException when missing', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    const ticket = (overrides: Partial<Ticket> = {}): Ticket =>
      ({
        id: 1,
        title: 't',
        description: 'd',
        status: TicketStatus.TODO,
        priority: TicketPriority.HIGH,
        type: TicketType.BUG,
        projectId: 1,
        assigneeId: null,
        dueDate: null,
        isOverdue: false,
        version: 1,
        ...overrides,
      }) as Ticket;

    it('throws 428 when expectedVersion is undefined', async () => {
      repo.findOne.mockResolvedValueOnce(ticket());
      await expect(
        service.update(1, { title: 'new' }, undefined),
      ).rejects.toThrow(PreconditionRequiredException);
    });

    it('throws 409 on version mismatch', async () => {
      repo.findOne.mockResolvedValueOnce(ticket({ version: 2 }));
      await expect(service.update(1, { title: 'x' }, 1)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws 400 when current status is DONE', async () => {
      repo.findOne.mockResolvedValueOnce(ticket({ status: TicketStatus.DONE }));
      await expect(service.update(1, { title: 'x' }, 1)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects backward transition (IN_PROGRESS -> TODO)', async () => {
      repo.findOne.mockResolvedValueOnce(
        ticket({ status: TicketStatus.IN_PROGRESS }),
      );
      const err = await service
        .update(1, { status: TicketStatus.TODO }, 1)
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toMatch(/Invalid status transition/);
    });

    it('allows same-status no-op', async () => {
      repo.findOne.mockResolvedValueOnce(ticket());
      repo.save.mockImplementation(async (t) => t as Ticket);
      await expect(
        service.update(1, { status: TicketStatus.TODO }, 1),
      ).resolves.toBeDefined();
    });

    it('allows TODO -> IN_PROGRESS', async () => {
      repo.findOne.mockResolvedValueOnce(ticket());
      repo.save.mockImplementation(async (t) => t as Ticket);
      const result = await service.update(
        1,
        { status: TicketStatus.IN_PROGRESS },
        1,
      );
      expect(result.status).toBe(TicketStatus.IN_PROGRESS);
    });

    it('allows TODO -> DONE (skip transitions)', async () => {
      repo.findOne.mockResolvedValueOnce(ticket());
      repo.save.mockImplementation(async (t) => t as Ticket);
      const result = await service.update(
        1,
        { status: TicketStatus.DONE },
        1,
      );
      expect(result.status).toBe(TicketStatus.DONE);
    });

    it('rejects unknown assigneeId on update', async () => {
      repo.findOne.mockResolvedValueOnce(ticket());
      users.findOne.mockRejectedValueOnce(new NotFoundException());
      const err = await service
        .update(1, { assigneeId: 88 }, 1)
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toMatch(/Assignee user 88 does not exist/);
    });

    it('only mutates whitelisted fields (sneaky projectId ignored)', async () => {
      repo.findOne.mockResolvedValueOnce(ticket());
      repo.save.mockImplementation(async (t) => t as Ticket);

      const dirty: Record<string, unknown> = { title: 'New', projectId: 99 };
      const result = await service.update(1, dirty as never, 1);

      expect(result.title).toBe('New');
      expect(result.projectId).toBe(1);
    });
  });

  describe('softDelete', () => {
    it('calls repo.softDelete with the id', async () => {
      repo.softDelete.mockResolvedValueOnce({ affected: 1, raw: {} } as never);
      await service.softDelete(1);
      expect(repo.softDelete).toHaveBeenCalledWith(1);
    });

    it('throws NotFoundException when nothing was deleted', async () => {
      repo.softDelete.mockResolvedValueOnce({ affected: 0, raw: {} } as never);
      await expect(service.softDelete(1)).rejects.toThrow(NotFoundException);
    });
  });
});
