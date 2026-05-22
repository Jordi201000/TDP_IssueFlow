import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AuditAction } from '../enums/audit-action.enum';
import { AuditActor } from '../enums/audit-actor.enum';
import { AuditEntityType } from '../enums/audit-entity-type.enum';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 32 })
  action: AuditAction;

  @Column({ name: 'entity_type', type: 'varchar', length: 32 })
  entityType: AuditEntityType;

  @Column({ name: 'entity_id' })
  entityId: number;

  @Column({ name: 'performed_by', type: 'int', nullable: true })
  performedBy: number | null;

  @Column({ type: 'varchar', length: 16 })
  actor: AuditActor;

  @Column({ type: 'simple-json', nullable: true })
  payload: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  timestamp: Date;
}
