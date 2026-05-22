import {
  CreateDateColumn,
  Entity,
  PrimaryColumn,
} from 'typeorm';

@Entity('comment_mentions')
export class CommentMention {
  @PrimaryColumn({ name: 'comment_id' })
  commentId: number;

  @PrimaryColumn({ name: 'mentioned_user_id' })
  mentionedUserId: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
