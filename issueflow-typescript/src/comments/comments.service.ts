import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/enums/audit-action.enum';
import { AuditEntityType } from '../audit-log/enums/audit-entity-type.enum';
import { AuditContext } from '../audit-log/interfaces/audit-context.interface';
import { PreconditionRequiredException } from '../common/exceptions/precondition-required.exception';
import { MentionsService } from '../mentions/mentions.service';
import { TicketsService } from '../tickets/tickets.service';
import { UsersService } from '../users/users.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { Comment } from './entities/comment.entity';

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(Comment)
    private readonly comments: Repository<Comment>,
    private readonly tickets: TicketsService,
    private readonly users: UsersService,
    private readonly audit: AuditLogService,
    private readonly mentions: MentionsService,
  ) {}

  async create(
    ticketId: number,
    dto: CreateCommentDto,
    ctx?: AuditContext,
  ): Promise<Comment> {
    // Propagates NotFoundException → uniform 404 if ticket missing/soft-deleted.
    await this.tickets.findOne(ticketId);

    const author = await this.users.findOne(dto.authorId).catch(() => null);
    if (!author) {
      throw new BadRequestException(
        `Author user ${dto.authorId} does not exist`,
      );
    }

    const comment = this.comments.create({
      ticketId,
      authorId: dto.authorId,
      content: dto.content,
    });
    const saved = await this.comments.save(comment);
    await this.mentions.persistFor(saved.id, saved.content);
    if (ctx) {
      await this.audit.record({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.COMMENT,
        entityId: saved.id,
        actor: ctx.actor,
        performedBy: ctx.performedBy,
        payload: {
          snapshot: {
            id: saved.id,
            ticketId: saved.ticketId,
            authorId: saved.authorId,
          },
        },
      });
    }
    return saved;
  }

  async findAllByTicket(ticketId: number): Promise<Comment[]> {
    await this.tickets.findOne(ticketId);
    return this.comments.find({ where: { ticketId } });
  }

  async findOneInTicket(
    ticketId: number,
    commentId: number,
  ): Promise<Comment> {
    const comment = await this.comments.findOne({
      where: { id: commentId, ticketId },
    });
    if (!comment) {
      throw new NotFoundException(
        `Comment ${commentId} not found in ticket ${ticketId}`,
      );
    }
    return comment;
  }

  async update(
    ticketId: number,
    commentId: number,
    dto: UpdateCommentDto,
    expectedVersion: number | undefined,
    ctx?: AuditContext,
  ): Promise<Comment> {
    if (expectedVersion === undefined) {
      throw new PreconditionRequiredException('If-Match header required');
    }
    const comment = await this.findOneInTicket(ticketId, commentId);
    if (comment.version !== expectedVersion) {
      throw new ConflictException(
        'Comment has been modified since last fetch',
      );
    }
    comment.content = dto.content;
    const saved = await this.comments.save(comment);
    await this.mentions.persistFor(saved.id, saved.content);
    if (ctx) {
      await this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.COMMENT,
        entityId: saved.id,
        actor: ctx.actor,
        performedBy: ctx.performedBy,
        payload: { changes: dto, version: saved.version },
      });
    }
    return saved;
  }

  async remove(
    ticketId: number,
    commentId: number,
    ctx?: AuditContext,
  ): Promise<void> {
    const comment = await this.findOneInTicket(ticketId, commentId);
    await this.comments.delete(comment.id);
    if (ctx) {
      await this.audit.record({
        action: AuditAction.DELETE,
        entityType: AuditEntityType.COMMENT,
        entityId: comment.id,
        actor: ctx.actor,
        performedBy: ctx.performedBy,
      });
    }
  }
}
