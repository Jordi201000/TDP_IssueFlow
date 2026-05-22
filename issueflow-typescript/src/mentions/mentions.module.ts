import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Comment } from '../comments/entities/comment.entity';
import { User } from '../users/entities/user.entity';
import { CommentMention } from './entities/comment-mention.entity';
import { MentionsController } from './mentions.controller';
import { MentionsService } from './mentions.service';

@Module({
  imports: [TypeOrmModule.forFeature([CommentMention, Comment, User])],
  controllers: [MentionsController],
  providers: [MentionsService],
  exports: [MentionsService],
})
export class MentionsModule {}
