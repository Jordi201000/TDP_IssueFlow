import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/enums/audit-action.enum';
import { AuditEntityType } from '../audit-log/enums/audit-entity-type.enum';
import { AuditContext } from '../audit-log/interfaces/audit-context.interface';
import { TicketsService } from '../tickets/tickets.service';
import { TicketDependency } from './entities/ticket-dependency.entity';

export interface BlockerSummary {
  id: number;
  title: string;
  status: string;
}

@Injectable()
export class DependenciesService {
  constructor(
    @InjectRepository(TicketDependency)
    private readonly deps: Repository<TicketDependency>,
    private readonly tickets: TicketsService,
    private readonly audit: AuditLogService,
  ) {}

  async add(
    ticketId: number,
    blockerId: number,
    ctx?: AuditContext,
  ): Promise<void> {
    if (ticketId === blockerId) {
      throw new BadRequestException('A ticket cannot block itself');
    }
    const [ticket, blocker] = await Promise.all([
      this.tickets.findOne(ticketId),
      this.tickets.findOne(blockerId),
    ]);
    if (ticket.projectId !== blocker.projectId) {
      throw new BadRequestException(
        `Tickets ${ticketId} and ${blockerId} belong to different projects`,
      );
    }
    const existing = await this.deps.findOne({
      where: { ticketId, blockerId },
    });
    if (existing) return; // idempotent — no second audit emit

    if (await this.wouldCreateCycle(ticketId, blockerId)) {
      throw new BadRequestException(
        `Adding this dependency would create a cycle`,
      );
    }

    await this.deps.save(this.deps.create({ ticketId, blockerId }));

    if (ctx) {
      await this.audit.record({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.TICKET_DEPENDENCY,
        entityId: ticketId,
        actor: ctx.actor,
        performedBy: ctx.performedBy,
        payload: { blockerId },
      });
    }
  }

  async listBlockers(ticketId: number): Promise<BlockerSummary[]> {
    await this.tickets.findOne(ticketId);
    const rows = await this.deps.find({ where: { ticketId } });
    const out: BlockerSummary[] = [];
    for (const row of rows) {
      const blocker = await this.tickets.findOne(row.blockerId).catch(() => null);
      if (blocker) {
        out.push({
          id: blocker.id,
          title: blocker.title,
          status: blocker.status,
        });
      }
    }
    return out;
  }

  async remove(
    ticketId: number,
    blockerId: number,
    ctx?: AuditContext,
  ): Promise<void> {
    const result = await this.deps.delete({ ticketId, blockerId });
    if (!result.affected) {
      throw new NotFoundException(
        `Dependency (${ticketId} blocked by ${blockerId}) not found`,
      );
    }
    if (ctx) {
      await this.audit.record({
        action: AuditAction.DELETE,
        entityType: AuditEntityType.TICKET_DEPENDENCY,
        entityId: ticketId,
        actor: ctx.actor,
        performedBy: ctx.performedBy,
        payload: { blockerId },
      });
    }
  }

  /**
   * DFS from `blockerId` walking blocker-edges. If `ticketId` is reachable,
   * adding (ticketId → blockerId) would close a cycle.
   */
  private async wouldCreateCycle(
    ticketId: number,
    blockerId: number,
  ): Promise<boolean> {
    const seen = new Set<number>();
    const stack = [blockerId];
    while (stack.length) {
      const current = stack.pop() as number;
      if (current === ticketId) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      const next = await this.deps.find({ where: { ticketId: current } });
      for (const row of next) stack.push(row.blockerId);
    }
    return false;
  }
}
