import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/enums/audit-action.enum';
import { AuditEntityType } from '../audit-log/enums/audit-entity-type.enum';
import { AuditContext } from '../audit-log/interfaces/audit-context.interface';
import { UsersService } from '../users/users.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { Project } from './entities/project.entity';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    private readonly users: UsersService,
    private readonly audit: AuditLogService,
  ) {}

  async create(dto: CreateProjectDto, ctx?: AuditContext): Promise<Project> {
    const owner = await this.users.findOne(dto.ownerId).catch(() => null);
    if (!owner) {
      throw new BadRequestException(
        `Owner user ${dto.ownerId} does not exist`,
      );
    }
    const project = this.projects.create({
      name: dto.name,
      description: dto.description,
      ownerId: dto.ownerId,
    });
    const saved = await this.projects.save(project);
    if (ctx) {
      await this.audit.record({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.PROJECT,
        entityId: saved.id,
        actor: ctx.actor,
        performedBy: ctx.performedBy,
        payload: {
          snapshot: {
            id: saved.id,
            name: saved.name,
            description: saved.description,
            ownerId: saved.ownerId,
          },
        },
      });
    }
    return saved;
  }

  findAll(): Promise<Project[]> {
    return this.projects.find();
  }

  async findOne(id: number): Promise<Project> {
    const project = await this.projects.findOne({ where: { id } });
    if (!project) {
      throw new NotFoundException(`Project ${id} not found`);
    }
    return project;
  }

  async update(
    id: number,
    dto: UpdateProjectDto,
    ctx?: AuditContext,
  ): Promise<Project> {
    const project = await this.findOne(id);
    if (dto.name !== undefined) project.name = dto.name;
    if (dto.description !== undefined) project.description = dto.description;
    const saved = await this.projects.save(project);
    if (ctx) {
      await this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.PROJECT,
        entityId: saved.id,
        actor: ctx.actor,
        performedBy: ctx.performedBy,
        payload: { changes: dto },
      });
    }
    return saved;
  }

  async softDelete(id: number, ctx?: AuditContext): Promise<void> {
    const result = await this.projects.softDelete(id);
    if (!result.affected) {
      throw new NotFoundException(`Project ${id} not found`);
    }
    if (ctx) {
      await this.audit.record({
        action: AuditAction.DELETE,
        entityType: AuditEntityType.PROJECT,
        entityId: id,
        actor: ctx.actor,
        performedBy: ctx.performedBy,
      });
    }
  }

  findDeleted(): Promise<Project[]> {
    return this.projects.find({
      where: { deletedAt: Not(IsNull()) },
      withDeleted: true,
    });
  }

  async restore(id: number, ctx?: AuditContext): Promise<void> {
    const result = await this.projects.restore(id);
    if (!result.affected) {
      throw new NotFoundException(`Soft-deleted project ${id} not found`);
    }
    if (ctx) {
      await this.audit.record({
        action: AuditAction.RESTORE,
        entityType: AuditEntityType.PROJECT,
        entityId: id,
        actor: ctx.actor,
        performedBy: ctx.performedBy,
      });
    }
  }
}
