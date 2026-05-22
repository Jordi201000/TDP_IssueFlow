import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { In, Not, Repository } from 'typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/enums/audit-action.enum';
import { AuditEntityType } from '../audit-log/enums/audit-entity-type.enum';
import { AuditContext } from '../audit-log/interfaces/audit-context.interface';
import { PreconditionRequiredException } from '../common/exceptions/precondition-required.exception';
import { TicketStatus, isForwardOrSame } from '../common/enums/ticket-status.enum';
import {
  ImportSummary,
  parseTicketCsv,
  serializeTicketsToCsv,
} from './csv/ticket-csv';
import { TicketDependency } from '../dependencies/entities/ticket-dependency.entity';
import { ProjectsService } from '../projects/projects.service';
import { UsersService } from '../users/users.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { Ticket } from './entities/ticket.entity';

@Injectable()
export class TicketsService {
  constructor(
    @InjectRepository(Ticket)
    private readonly tickets: Repository<Ticket>,
    @InjectRepository(TicketDependency)
    private readonly deps: Repository<TicketDependency>,
    private readonly projects: ProjectsService,
    private readonly users: UsersService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Returns blocker ticket ids that are not yet DONE.
   * Used by `update()` to enforce the §3.2 rule: a ticket cannot transition
   * to DONE if it has unresolved blockers.
   */
  async openBlockerIds(ticketId: number): Promise<number[]> {
    const edges = await this.deps.find({ where: { ticketId } });
    if (edges.length === 0) return [];
    const blockerIds = edges.map((e) => e.blockerId);
    const openBlockers = await this.tickets.find({
      where: { id: In(blockerIds), status: Not(TicketStatus.DONE) },
    });
    return openBlockers.map((b) => b.id);
  }

  async create(dto: CreateTicketDto, ctx?: AuditContext): Promise<Ticket> {
    const project = await this.projects.findOne(dto.projectId).catch(() => null);
    if (!project) {
      throw new BadRequestException(`Project ${dto.projectId} does not exist`);
    }

    if (dto.assigneeId !== undefined && dto.assigneeId !== null) {
      const assignee = await this.users.findOne(dto.assigneeId).catch(() => null);
      if (!assignee) {
        throw new BadRequestException(
          `Assignee user ${dto.assigneeId} does not exist`,
        );
      }
    }

    const ticket = this.tickets.create({
      title: dto.title,
      description: dto.description,
      status: dto.status,
      priority: dto.priority,
      type: dto.type,
      projectId: dto.projectId,
      assigneeId: dto.assigneeId ?? null,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      isOverdue: false,
    });
    const saved = await this.tickets.save(ticket);
    if (ctx) {
      await this.audit.record({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.TICKET,
        entityId: saved.id,
        actor: ctx.actor,
        performedBy: ctx.performedBy,
        payload: {
          snapshot: {
            id: saved.id,
            title: saved.title,
            status: saved.status,
            priority: saved.priority,
            type: saved.type,
            projectId: saved.projectId,
            assigneeId: saved.assigneeId,
          },
        },
      });
    }
    return saved;
  }

  findAllByProject(projectId: number): Promise<Ticket[]> {
    return this.tickets.find({ where: { projectId } });
  }

  async findOne(id: number): Promise<Ticket> {
    const ticket = await this.tickets.findOne({ where: { id } });
    if (!ticket) {
      throw new NotFoundException(`Ticket ${id} not found`);
    }
    return ticket;
  }

  async update(
    id: number,
    dto: UpdateTicketDto,
    expectedVersion: number | undefined,
    ctx?: AuditContext,
  ): Promise<Ticket> {
    if (expectedVersion === undefined) {
      throw new PreconditionRequiredException('If-Match header required');
    }

    const ticket = await this.findOne(id);

    if (ticket.version !== expectedVersion) {
      throw new ConflictException(
        'Ticket has been modified since last fetch',
      );
    }

    if (ticket.status === TicketStatus.DONE) {
      throw new BadRequestException('Ticket is DONE and cannot be updated');
    }

    if (
      dto.status !== undefined &&
      !isForwardOrSame(ticket.status, dto.status)
    ) {
      throw new BadRequestException(
        `Invalid status transition from ${ticket.status} to ${dto.status}`,
      );
    }

    if (dto.assigneeId !== undefined && dto.assigneeId !== null) {
      const assignee = await this.users
        .findOne(dto.assigneeId)
        .catch(() => null);
      if (!assignee) {
        throw new BadRequestException(
          `Assignee user ${dto.assigneeId} does not exist`,
        );
      }
    }

    if (dto.status === TicketStatus.DONE) {
      const openBlockers = await this.openBlockerIds(id);
      if (openBlockers.length > 0) {
        throw new BadRequestException(
          `Ticket cannot transition to DONE: open blockers [${openBlockers.join(', ')}]`,
        );
      }
    }

    if (dto.title !== undefined) ticket.title = dto.title;
    if (dto.description !== undefined) ticket.description = dto.description;
    if (dto.status !== undefined) ticket.status = dto.status;
    if (dto.priority !== undefined) ticket.priority = dto.priority;
    if (dto.assigneeId !== undefined) ticket.assigneeId = dto.assigneeId;
    if (dto.dueDate !== undefined) {
      ticket.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    }

    const saved = await this.tickets.save(ticket);
    if (ctx) {
      await this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.TICKET,
        entityId: saved.id,
        actor: ctx.actor,
        performedBy: ctx.performedBy,
        payload: { changes: dto, version: saved.version },
      });
    }
    return saved;
  }

  async exportProject(projectId: number): Promise<string> {
    await this.projects.findOne(projectId); // 404 if missing/soft-deleted
    const tickets = await this.findAllByProject(projectId);
    return serializeTicketsToCsv(tickets);
  }

  async importProject(
    projectId: number,
    buffer: Buffer,
    ctx: AuditContext,
  ): Promise<ImportSummary> {
    await this.projects.findOne(projectId); // 404 if missing/soft-deleted

    let rows;
    try {
      rows = parseTicketCsv(buffer);
    } catch (err) {
      throw new BadRequestException(`Malformed CSV: ${(err as Error).message}`);
    }

    const summary: ImportSummary = { created: 0, failed: 0, errors: [] };

    for (const { row, data } of rows) {
      const dto = plainToInstance(CreateTicketDto, {
        title: data.title,
        description: data.description,
        status: data.status,
        priority: data.priority,
        type: data.type,
        projectId,
        assigneeId: data.assigneeId ? Number(data.assigneeId) : undefined,
      });

      const validationErrors = await validate(dto);
      if (validationErrors.length > 0) {
        summary.failed++;
        summary.errors.push({
          row,
          message: validationErrors
            .flatMap((e) => Object.values(e.constraints ?? {}))
            .join('; '),
        });
        continue;
      }

      try {
        await this.create(dto, ctx);
        summary.created++;
      } catch (err) {
        summary.failed++;
        summary.errors.push({ row, message: (err as Error).message });
      }
    }

    return summary;
  }

  async softDelete(id: number, ctx?: AuditContext): Promise<void> {
    const result = await this.tickets.softDelete(id);
    if (!result.affected) {
      throw new NotFoundException(`Ticket ${id} not found`);
    }
    if (ctx) {
      await this.audit.record({
        action: AuditAction.DELETE,
        entityType: AuditEntityType.TICKET,
        entityId: id,
        actor: ctx.actor,
        performedBy: ctx.performedBy,
      });
    }
  }
}
