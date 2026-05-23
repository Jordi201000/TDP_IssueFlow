import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { AuditActor } from '../audit-log/enums/audit-actor.enum';
import { parseIfMatch } from '../common/helpers/if-match';
import { EtagInterceptor } from '../common/interceptors/etag.interceptor';
import { MentionedUser, MentionsService } from '../mentions/mentions.service';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
interface CommentResponse {
  id: number;
  ticketId: number;
  authorId: number;
  content: string;
  version: number;
  mentionedUsers: MentionedUser[];
}

@Controller('tickets/:ticketId/comments')
@UseInterceptors(EtagInterceptor)
export class CommentsController {
  constructor(
    private readonly comments: CommentsService,
    private readonly mentions: MentionsService,
  ) {}

  @Get()
  async findAll(
    @Param('ticketId', ParseIntPipe) ticketId: number,
  ): Promise<CommentResponse[]> {
    const list = await this.comments.findAllByTicket(ticketId);
    const byCommentId = await this.mentions.getMentionedUsersBatch(
      list.map((c) => c.id),
    );
    return list.map((c) =>
      this.toResponse(c, byCommentId[c.id] ?? []),
    );
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async create(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Body() dto: CreateCommentDto,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<CommentResponse> {
    const comment = await this.comments.create(ticketId, dto, {
      actor: AuditActor.USER,
      performedBy: me.userId,
    });
    const mentionedUsers = await this.mentions.getMentionedUsersFor(
      comment.id,
    );
    return this.toResponse(comment, mentionedUsers);
  }

  @Get(':commentId')
  async findOne(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Param('commentId', ParseIntPipe) commentId: number,
  ): Promise<CommentResponse> {
    const comment = await this.comments.findOneInTicket(ticketId, commentId);
    const mentionedUsers = await this.mentions.getMentionedUsersFor(
      comment.id,
    );
    return this.toResponse(comment, mentionedUsers);
  }

  @Patch(':commentId')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Param('commentId', ParseIntPipe) commentId: number,
    @Body() dto: UpdateCommentDto,
    @Headers('if-match') ifMatch: string | undefined,
    @CurrentUser() me: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const expectedVersion = parseIfMatch(ifMatch);
    const updated = await this.comments.update(
      ticketId,
      commentId,
      dto,
      expectedVersion,
      { actor: AuditActor.USER, performedBy: me.userId },
    );
    res.setHeader('ETag', `"${updated.version}"`);
  }

  @Delete(':commentId')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Param('commentId', ParseIntPipe) commentId: number,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<void> {
    await this.comments.remove(ticketId, commentId, {
      actor: AuditActor.USER,
      performedBy: me.userId,
    });
  }

  private toResponse(
    comment: {
      id: number;
      ticketId: number;
      authorId: number;
      content: string;
      version: number;
    },
    mentionedUsers: MentionedUser[],
  ): CommentResponse {
    return {
      id: comment.id,
      ticketId: comment.ticketId,
      authorId: comment.authorId,
      content: comment.content,
      version: comment.version,
      mentionedUsers,
    };
  }
}
