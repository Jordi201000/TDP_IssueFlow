import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { AuditAction } from './enums/audit-action.enum';
import { AuditActor } from './enums/audit-actor.enum';
import { AuditEntityType } from './enums/audit-entity-type.enum';

export interface AuditEntry {
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: number;
  actor: AuditActor;
  performedBy: number | null;
  payload?: Record<string, unknown>;
}

export interface AuditFilter {
  entityType?: AuditEntityType;
  entityId?: number;
  action?: AuditAction;
  actor?: AuditActor;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.repo.save(
        this.repo.create({
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          performedBy: entry.performedBy,
          actor: entry.actor,
          payload: entry.payload ?? null,
        }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to write audit log (${entry.action} ${entry.entityType}#${entry.entityId})`,
        err as Error,
      );
    }
  }

  findAll(filter: AuditFilter): Promise<AuditLog[]> {
    const where: AuditFilter = {};
    if (filter.entityType !== undefined) where.entityType = filter.entityType;
    if (filter.entityId !== undefined) where.entityId = filter.entityId;
    if (filter.action !== undefined) where.action = filter.action;
    if (filter.actor !== undefined) where.actor = filter.actor;
    return this.repo.find({
      where,
      order: { timestamp: 'DESC', id: 'DESC' },
    });
  }
}
