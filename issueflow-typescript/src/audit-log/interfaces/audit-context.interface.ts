import { AuditActor } from '../enums/audit-actor.enum';

export interface AuditContext {
  actor: AuditActor;
  performedBy: number | null;
}
