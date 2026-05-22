import {
  CreateDateColumn,
  Entity,
  PrimaryColumn,
} from 'typeorm';

@Entity('ticket_dependencies')
export class TicketDependency {
  @PrimaryColumn({ name: 'ticket_id' })
  ticketId: number;

  @PrimaryColumn({ name: 'blocker_id' })
  blockerId: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
