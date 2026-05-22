import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { Role } from '../common/enums/role.enum';
import { TicketStatus } from '../common/enums/ticket-status.enum';
import { Project } from '../projects/entities/project.entity';
import { Ticket } from '../tickets/entities/ticket.entity';
import { User } from '../users/entities/user.entity';

export interface WorkloadEntry {
  userId: number;
  username: string;
  openTicketCount: number;
}

@Injectable()
export class WorkloadService {
  constructor(
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    @InjectRepository(Ticket)
    private readonly tickets: Repository<Ticket>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  /**
   * Derived membership per D5: owner + DISTINCT (non-null) ticket assignees.
   * Soft-deleted tickets / projects auto-excluded by TypeORM.
   */
  async getMemberIds(projectId: number): Promise<number[]> {
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) return [];
    const ids = new Set<number>([project.ownerId]);
    const ticketsWithAssignee = await this.tickets.find({
      where: { projectId, assigneeId: Not(IsNull()) },
      select: ['assigneeId'],
    });
    for (const t of ticketsWithAssignee) {
      if (t.assigneeId !== null) ids.add(t.assigneeId);
    }
    return [...ids];
  }

  /**
   * Picks the least-loaded DEVELOPER member; tie-breaks by oldest registration (lowest id).
   * Returns null when no DEVELOPER is linked to the project.
   */
  async pickAutoAssignee(projectId: number): Promise<number | null> {
    const memberIds = await this.getMemberIds(projectId);
    if (memberIds.length === 0) return null;

    const devs = await this.users.find({
      where: { id: In(memberIds), role: Role.DEVELOPER },
      order: { id: 'ASC' },
    });
    if (devs.length === 0) return null;

    const tickets = await this.tickets.find({
      where: {
        projectId,
        status: Not(TicketStatus.DONE),
        assigneeId: In(devs.map((d) => d.id)),
      },
      select: ['assigneeId'],
    });

    const counts = new Map<number, number>();
    for (const d of devs) counts.set(d.id, 0);
    for (const t of tickets) {
      if (t.assigneeId !== null) {
        counts.set(t.assigneeId, (counts.get(t.assigneeId) ?? 0) + 1);
      }
    }

    let pick = devs[0].id;
    let pickCount = counts.get(pick) ?? 0;
    for (const d of devs) {
      const c = counts.get(d.id) ?? 0;
      if (c < pickCount) {
        pick = d.id;
        pickCount = c;
      }
    }
    return pick;
  }

  /**
   * Per spec §3.8: returns all users in the project (ADMIN + DEVELOPER),
   * each with their open (non-DONE) ticket count, sorted by count ASC.
   */
  async getWorkload(projectId: number): Promise<WorkloadEntry[]> {
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }

    const memberIds = await this.getMemberIds(projectId);
    if (memberIds.length === 0) return [];

    const users = await this.users.find({
      where: { id: In(memberIds) },
      order: { id: 'ASC' },
    });

    const tickets = await this.tickets.find({
      where: {
        projectId,
        status: Not(TicketStatus.DONE),
        assigneeId: In(memberIds),
      },
      select: ['assigneeId'],
    });

    const counts = new Map<number, number>();
    for (const u of users) counts.set(u.id, 0);
    for (const t of tickets) {
      if (t.assigneeId !== null) {
        counts.set(t.assigneeId, (counts.get(t.assigneeId) ?? 0) + 1);
      }
    }

    return users
      .map((u) => ({
        userId: u.id,
        username: u.username,
        openTicketCount: counts.get(u.id) ?? 0,
      }))
      .sort((a, b) => a.openTicketCount - b.openTicketCount);
  }
}
