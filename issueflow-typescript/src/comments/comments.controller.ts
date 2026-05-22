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
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { Comment } from './entities/comment.entity';

interface CommentResponse extends Comment {
  mentionedUsers: Array<{ id: number; username: string; fullName: string }>;
}

function withMentionedUsers(comment: Comment): CommentResponse {
  // Phase 11 will populate mentionedUsers from the comment_mentions join.
  return Object.assign(comment, { mentionedUsers: [] });
}

@Controller('tickets/:ticketId/comments')
@UseInterceptors(EtagInterceptor)
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get()
  async findAll(
    @Param('ticketId', ParseIntPipe) ticketId: number,
  ): Promise<CommentResponse[]> {
    const list = await this.comments.findAllByTicket(ticketId);
    return list.map(withMentionedUsers);
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
    return withMentionedUsers(comment);
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
}
