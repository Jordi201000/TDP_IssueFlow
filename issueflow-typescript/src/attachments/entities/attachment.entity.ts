import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('attachments')
export class Attachment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'ticket_id' })
  ticketId: number;

  @Column({ length: 255 })
  filename: string;

  @Column({ name: 'content_type', length: 100 })
  contentType: string;

  @Column({ name: 'size_bytes' })
  @Exclude()
  sizeBytes: number;

  @Column({ name: 'storage_path', length: 500 })
  @Exclude()
  storagePath: string;

  @Column({ name: 'uploaded_by_id' })
  @Exclude()
  uploadedById: number;

  @CreateDateColumn({ name: 'created_at' })
  @Exclude()
  createdAt: Date;
}
