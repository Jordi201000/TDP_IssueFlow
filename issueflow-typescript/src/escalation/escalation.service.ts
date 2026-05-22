import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Not, Repository } from 'typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/enums/audit-action.enum';
import { AuditActor } from '../audit-log/enums/audit-actor.enum';
import { AuditEntityType } from '../audit-log/enums/audit-entity-type.enum';
import {
  TicketPriority,
  nextPriority,
} from '../common/enums/ticket-priority.enum';
import { TicketStatus } from '../common/enums/ticket-status.enum';
import { Ticket } from '../tickets/entities/ticket.entity';

export interface EscalationResult {
  scanned: number;
  escalated: number;
}

@Injectable()
export class EscalationService {
  private readonly logger = new Logger(EscalationService.name);

  constructor(
    @InjectRepository(Ticket)
    private readonly tickets: Repository<Ticket>,
    private readonly audit: AuditLogService,
  ) {}

  // 6-field cron: every 30 seconds. Dev-friendly cadence; would be every 5+ min in prod.
  @Cron(CronExpression.EVERY_30_SECONDS)
  async handleCron(): Promise<void> {
    const result = await this.runEscalation();
    if (result.escalated > 0) {
      this.logger.log(
        `Escalation cycle: scanned=${result.scanned} escalated=${result.escalated}`,
      );
    }
  }

  async runEscalation(): Promise<EscalationResult> {
    const now = new Date();
    const overdue = await this.tickets.find({
      where: {
        dueDate: LessThan(now),
        status: Not(TicketStatus.DONE),
      },
    });

    let escalated = 0;
    for (const ticket of overdue) {
      if (ticket.priority !== TicketPriority.CRITICAL) {
        const from = ticket.priority;
        const to = nextPriority(from);
        ticket.priority = to;
        await this.tickets.save(ticket);
        await this.audit.record({
          action: AuditAction.AUTO_ESCALATE,
          entityType: AuditEntityType.TICKET,
          entityId: ticket.id,
          actor: AuditActor.SYSTEM,
          performedBy: null,
          payload: { from, to },
        });
        escalated++;
      } else if (!ticket.isOverdue) {
        ticket.isOverdue = true;
        await this.tickets.save(ticket);
        await this.audit.record({
          action: AuditAction.AUTO_ESCALATE,
          entityType: AuditEntityType.TICKET,
          entityId: ticket.id,
          actor: AuditActor.SYSTEM,
          performedBy: null,
          payload: { priority: TicketPriority.CRITICAL, isOverdue: true },
        });
        escalated++;
      }
      // else: CRITICAL + isOverdue already → idempotent no-op.
    }

    return { scanned: overdue.length, escalated };
  }
}
