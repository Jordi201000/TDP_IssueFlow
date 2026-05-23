import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import { TicketPriority } from '../../common/enums/ticket-priority.enum';
import { TicketStatus } from '../../common/enums/ticket-status.enum';
import { TicketType } from '../../common/enums/ticket-type.enum';

@Entity('tickets')
export class Ticket {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 200 })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'varchar', length: 16 })
  status: TicketStatus;

  @Column({ type: 'varchar', length: 16 })
  priority: TicketPriority;

  @Column({ type: 'varchar', length: 16 })
  type: TicketType;

  @Column({ name: 'project_id' })
  projectId: number;

  @Column({ name: 'assignee_id', type: 'int', nullable: true })
  assigneeId: number | null;

  @Column({ name: 'due_date', nullable: true })
  dueDate: Date | null;

  @Column({ name: 'is_overdue', default: false })
  isOverdue: boolean;

  @VersionColumn()
  @Exclude()
  version: number;

  @CreateDateColumn({ name: 'created_at' })
  @Exclude()
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  @Exclude()
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  @Exclude()
  deletedAt: Date | null;
}
