import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Comment } from '../comments/entities/comment.entity';
import { User } from '../users/entities/user.entity';
import { CommentMention } from './entities/comment-mention.entity';
import { extractMentions } from './extract-mentions';

export interface MentionedUser {
  id: number;
  username: string;
  fullName: string;
}

export interface CommentWithMentions {
  id: number;
  ticketId: number;
  authorId: number;
  content: string;
  mentionedUsers: MentionedUser[];
}

export interface MentionsPage {
  data: CommentWithMentions[];
  total: number;
  page: number;
}

@Injectable()
export class MentionsService {
  constructor(
    @InjectRepository(CommentMention)
    private readonly mentions: Repository<CommentMention>,
    @InjectRepository(Comment)
    private readonly comments: Repository<Comment>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  /**
   * Re-evaluates the mention list for a comment: parses the content,
   * resolves usernames case-insensitively, and reconciles the DB rows
   * (inserts new, deletes removed). Unknown usernames are skipped silently.
   */
  async persistFor(commentId: number, content: string): Promise<void> {
    const names = extractMentions(content);

    // Resolve usernames → user ids case-insensitively.
    const resolvedIds = new Set<number>();
    if (names.length > 0) {
      const found = await this.users
        .createQueryBuilder('u')
        .where('LOWER(u.username) IN (:...names)', { names })
        .getMany();
      for (const u of found) resolvedIds.add(u.id);
    }

    const existing = await this.mentions.find({ where: { commentId } });
    const existingIds = new Set(existing.map((m) => m.mentionedUserId));

    const toAdd = [...resolvedIds].filter((id) => !existingIds.has(id));
    const toRemove = [...existingIds].filter((id) => !resolvedIds.has(id));

    if (toRemove.length > 0) {
      await this.mentions.delete({
        commentId,
        mentionedUserId: In(toRemove),
      });
    }
    if (toAdd.length > 0) {
      await this.mentions.save(
        toAdd.map((mentionedUserId) =>
          this.mentions.create({ commentId, mentionedUserId }),
        ),
      );
    }
  }

  async getMentionedUsersFor(commentId: number): Promise<MentionedUser[]> {
    const batch = await this.getMentionedUsersBatch([commentId]);
    return batch[commentId] ?? [];
  }

  async getMentionedUsersBatch(
    commentIds: number[],
  ): Promise<Record<number, MentionedUser[]>> {
    const result: Record<number, MentionedUser[]> = {};
    for (const id of commentIds) result[id] = [];
    if (commentIds.length === 0) return result;

    const rows = await this.mentions.find({
      where: { commentId: In(commentIds) },
    });
    if (rows.length === 0) return result;

    const userIds = [...new Set(rows.map((r) => r.mentionedUserId))];
    const users = await this.users.find({ where: { id: In(userIds) } });
    const userById = new Map(users.map((u) => [u.id, u]));

    for (const row of rows) {
      const u = userById.get(row.mentionedUserId);
      if (u) {
        result[row.commentId].push({
          id: u.id,
          username: u.username,
          fullName: u.fullName,
        });
      }
    }
    return result;
  }

  async findCommentsForUser(
    userId: number,
    page = 1,
    pageSize = 20,
  ): Promise<MentionsPage> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    const [comments, total] = await this.comments
      .createQueryBuilder('c')
      .innerJoin(CommentMention, 'cm', 'cm.commentId = c.id')
      .where('cm.mentionedUserId = :uid', { uid: userId })
      .orderBy('c.createdAt', 'DESC')
      .addOrderBy('c.id', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    const mentionsByComment = await this.getMentionedUsersBatch(
      comments.map((c) => c.id),
    );

    return {
      data: comments.map((c) => ({
        id: c.id,
        ticketId: c.ticketId,
        authorId: c.authorId,
        content: c.content,
        mentionedUsers: mentionsByComment[c.id] ?? [],
      })),
      total,
      page,
    };
  }
}
