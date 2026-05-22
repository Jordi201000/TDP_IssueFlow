import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PreconditionRequiredException } from '../common/exceptions/precondition-required.exception';
import { Ticket } from '../tickets/entities/ticket.entity';
import { TicketsService } from '../tickets/tickets.service';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { CommentsService } from './comments.service';
import { Comment } from './entities/comment.entity';

function makeRepo(): jest.Mocked<Repository<Comment>> {
  return {
    create: jest.fn((data: Partial<Comment>) => ({ ...data }) as Comment),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
  } as unknown as jest.Mocked<Repository<Comment>>;
}

describe('CommentsService', () => {
  let service: CommentsService;
  let repo: jest.Mocked<Repository<Comment>>;
  let tickets: jest.Mocked<Pick<TicketsService, 'findOne'>>;
  let users: jest.Mocked<Pick<UsersService, 'findOne'>>;

  beforeEach(async () => {
    repo = makeRepo();
    tickets = { findOne: jest.fn() };
    users = { findOne: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        CommentsService,
        { provide: getRepositoryToken(Comment), useValue: repo },
        { provide: TicketsService, useValue: tickets },
        { provide: UsersService, useValue: users },
        { provide: AuditLogService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = module.get(CommentsService);
  });

  describe('create', () => {
    it('persists when ticket + author exist', async () => {
      tickets.findOne.mockResolvedValueOnce({ id: 1 } as Ticket);
      users.findOne.mockResolvedValueOnce({ id: 2 } as User);
      repo.save.mockImplementation(async (c) => ({
        ...(c as Comment),
        id: 1,
        version: 1,
      }));

      const result = await service.create(1, { authorId: 2, content: 'hi' });
      expect(result.id).toBe(1);
      expect(result.ticketId).toBe(1);
      expect(result.authorId).toBe(2);
    });

    it('propagates NotFoundException when ticket missing', async () => {
      tickets.findOne.mockRejectedValueOnce(new NotFoundException('Ticket 99 not found'));
      await expect(
        service.create(99, { authorId: 2, content: 'hi' }),
      ).rejects.toThrow(NotFoundException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when author missing', async () => {
      tickets.findOne.mockResolvedValueOnce({ id: 1 } as Ticket);
      users.findOne.mockRejectedValueOnce(new NotFoundException());
      const err = await service
        .create(1, { authorId: 999, content: 'hi' })
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toMatch(/Author user 999 does not exist/);
    });
  });

  describe('findAllByTicket', () => {
    it('validates ticket then returns list', async () => {
      tickets.findOne.mockResolvedValueOnce({ id: 1 } as Ticket);
      repo.find.mockResolvedValueOnce([{ id: 1 } as Comment]);
      const result = await service.findAllByTicket(1);
      expect(result).toHaveLength(1);
      expect(repo.find).toHaveBeenCalledWith({ where: { ticketId: 1 } });
    });

    it('throws NotFoundException when ticket missing', async () => {
      tickets.findOne.mockRejectedValueOnce(new NotFoundException());
      await expect(service.findAllByTicket(99)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findOneInTicket', () => {
    it('returns when comment belongs to ticket', async () => {
      const c = { id: 1, ticketId: 1 } as Comment;
      repo.findOne.mockResolvedValueOnce(c);
      await expect(service.findOneInTicket(1, 1)).resolves.toBe(c);
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 1, ticketId: 1 },
      });
    });

    it('throws NotFoundException on path mismatch', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      await expect(service.findOneInTicket(2, 1)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    const comment = (overrides: Partial<Comment> = {}): Comment =>
      ({
        id: 1,
        ticketId: 1,
        authorId: 2,
        content: 'old',
        version: 1,
        ...overrides,
      }) as Comment;

    it('throws 428 when expectedVersion undefined', async () => {
      await expect(
        service.update(1, 1, { content: 'new' }, undefined),
      ).rejects.toThrow(PreconditionRequiredException);
    });

    it('throws 409 on version mismatch', async () => {
      repo.findOne.mockResolvedValueOnce(comment({ version: 2 }));
      await expect(
        service.update(1, 1, { content: 'new' }, 1),
      ).rejects.toThrow(ConflictException);
    });

    it('mutates only content and saves on happy path', async () => {
      repo.findOne.mockResolvedValueOnce(comment());
      repo.save.mockImplementation(async (c) => c as Comment);
      const result = await service.update(1, 1, { content: 'new' }, 1);
      expect(result.content).toBe('new');
      expect(result.authorId).toBe(2);
    });

    it('throws NotFoundException when comment not under ticket', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.update(1, 99, { content: 'x' }, 1),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes on happy path', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 1, ticketId: 1 } as Comment);
      repo.delete.mockResolvedValueOnce({ affected: 1, raw: {} } as never);
      await service.remove(1, 1);
      expect(repo.delete).toHaveBeenCalledWith(1);
    });

    it('throws NotFoundException when comment missing', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      await expect(service.remove(1, 99)).rejects.toThrow(NotFoundException);
    });
  });
});
