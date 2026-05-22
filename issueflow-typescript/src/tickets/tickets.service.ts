import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PreconditionRequiredException } from '../common/exceptions/precondition-required.exception';
import { TicketStatus, isForwardOrSame } from '../common/enums/ticket-status.enum';
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
    private readonly projects: ProjectsService,
    private readonly users: UsersService,
  ) {}

  async create(dto: CreateTicketDto): Promise<Ticket> {
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
    return this.tickets.save(ticket);
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

    // TODO Phase 7: when dto.status === DONE, refuse if open blockers exist.

    if (dto.title !== undefined) ticket.title = dto.title;
    if (dto.description !== undefined) ticket.description = dto.description;
    if (dto.status !== undefined) ticket.status = dto.status;
    if (dto.priority !== undefined) ticket.priority = dto.priority;
    if (dto.assigneeId !== undefined) ticket.assigneeId = dto.assigneeId;
    if (dto.dueDate !== undefined) {
      ticket.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    }

    return this.tickets.save(ticket);
  }

  async softDelete(id: number): Promise<void> {
    const result = await this.tickets.softDelete(id);
    if (!result.affected) {
      throw new NotFoundException(`Ticket ${id} not found`);
    }
  }
}
