import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Comment } from '../comments/entities/comment.entity';
import { User } from '../users/entities/user.entity';
import { CommentMention } from './entities/comment-mention.entity';
import { MentionsService } from './mentions.service';

function makeRepo<T>(): jest.Mocked<Repository<T>> {
  return {
    create: jest.fn((data: Partial<T>) => ({ ...data }) as T),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

describe('MentionsService', () => {
  let service: MentionsService;
  let mentionsRepo: jest.Mocked<Repository<CommentMention>>;
  let commentsRepo: jest.Mocked<Repository<Comment>>;
  let usersRepo: jest.Mocked<Repository<User>>;

  beforeEach(async () => {
    mentionsRepo = makeRepo<CommentMention>();
    commentsRepo = makeRepo<Comment>();
    usersRepo = makeRepo<User>();
    const module = await Test.createTestingModule({
      providers: [
        MentionsService,
        { provide: getRepositoryToken(CommentMention), useValue: mentionsRepo },
        { provide: getRepositoryToken(Comment), useValue: commentsRepo },
        { provide: getRepositoryToken(User), useValue: usersRepo },
      ],
    }).compile();
    service = module.get(MentionsService);
  });

  describe('persistFor', () => {
    function mockUserLookup(found: Partial<User>[]) {
      (usersRepo.createQueryBuilder as jest.Mock).mockReturnValueOnce({
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(found),
      });
    }

    it('inserts new mentions for resolved usernames', async () => {
      mockUserLookup([{ id: 2 }, { id: 3 }]);
      mentionsRepo.find.mockResolvedValueOnce([]);

      await service.persistFor(1, 'hey @alice and @bob');

      expect(mentionsRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ commentId: 1, mentionedUserId: 2 }),
        expect.objectContaining({ commentId: 1, mentionedUserId: 3 }),
      ]);
      expect(mentionsRepo.delete).not.toHaveBeenCalled();
    });

    it('silently skips unknown usernames', async () => {
      mockUserLookup([]); // no users found
      mentionsRepo.find.mockResolvedValueOnce([]);

      await service.persistFor(1, 'hey @nobody');

      expect(mentionsRepo.save).not.toHaveBeenCalled();
      expect(mentionsRepo.delete).not.toHaveBeenCalled();
    });

    it('replaces mentions: removes ones not in new content, adds new', async () => {
      mockUserLookup([{ id: 3 }]); // only carol resolves now
      mentionsRepo.find.mockResolvedValueOnce([
        { commentId: 1, mentionedUserId: 2 } as CommentMention, // bob existed
      ]);

      await service.persistFor(1, '@carol now');

      expect(mentionsRepo.delete).toHaveBeenCalledWith({
        commentId: 1,
        mentionedUserId: expect.objectContaining({ _type: 'in' }),
      });
      expect(mentionsRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ commentId: 1, mentionedUserId: 3 }),
      ]);
    });

    it('does nothing when content has no mentions', async () => {
      mentionsRepo.find.mockResolvedValueOnce([]);
      await service.persistFor(1, 'just a comment');
      expect(usersRepo.createQueryBuilder).not.toHaveBeenCalled();
      expect(mentionsRepo.save).not.toHaveBeenCalled();
      expect(mentionsRepo.delete).not.toHaveBeenCalled();
    });
  });

  describe('getMentionedUsersBatch', () => {
    it('returns empty map for empty input', async () => {
      await expect(service.getMentionedUsersBatch([])).resolves.toEqual({});
    });

    it('returns hydrated [{id,username,fullName}] keyed by commentId', async () => {
      mentionsRepo.find.mockResolvedValueOnce([
        { commentId: 1, mentionedUserId: 2 } as CommentMention,
        { commentId: 1, mentionedUserId: 3 } as CommentMention,
        { commentId: 4, mentionedUserId: 2 } as CommentMention,
      ]);
      usersRepo.find.mockResolvedValueOnce([
        { id: 2, username: 'alice', fullName: 'Alice A' } as User,
        { id: 3, username: 'bob', fullName: 'Bob B' } as User,
      ]);

      const result = await service.getMentionedUsersBatch([1, 4, 99]);

      expect(result[1]).toEqual([
        { id: 2, username: 'alice', fullName: 'Alice A' },
        { id: 3, username: 'bob', fullName: 'Bob B' },
      ]);
      expect(result[4]).toEqual([
        { id: 2, username: 'alice', fullName: 'Alice A' },
      ]);
      expect(result[99]).toEqual([]);
    });
  });

  describe('findCommentsForUser', () => {
    it('throws NotFound when user missing', async () => {
      usersRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.findCommentsForUser(99)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns paginated shape { data, total, page }', async () => {
      usersRepo.findOne.mockResolvedValueOnce({ id: 7 } as User);
      const comments = [
        { id: 11, ticketId: 1, authorId: 2, content: '@me hi' } as Comment,
      ];
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([comments, 5]),
      };
      (commentsRepo.createQueryBuilder as jest.Mock).mockReturnValueOnce(qb);
      mentionsRepo.find.mockResolvedValueOnce([
        { commentId: 11, mentionedUserId: 7 } as CommentMention,
      ]);
      usersRepo.find.mockResolvedValueOnce([
        { id: 7, username: 'me', fullName: 'Me' } as User,
      ]);

      const result = await service.findCommentsForUser(7, 1, 20);

      expect(result.total).toBe(5);
      expect(result.page).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual({
        id: 11,
        ticketId: 1,
        authorId: 2,
        content: '@me hi',
        mentionedUsers: [{ id: 7, username: 'me', fullName: 'Me' }],
      });
      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(20);
    });

    it('respects page > 1 offset', async () => {
      usersRepo.findOne.mockResolvedValueOnce({ id: 7 } as User);
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 5]),
      };
      (commentsRepo.createQueryBuilder as jest.Mock).mockReturnValueOnce(qb);

      await service.findCommentsForUser(7, 3, 2);

      expect(qb.skip).toHaveBeenCalledWith(4);
      expect(qb.take).toHaveBeenCalledWith(2);
    });
  });
});
