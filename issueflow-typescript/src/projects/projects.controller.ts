import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { AuditActor } from '../audit-log/enums/audit-actor.enum';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { Project } from './entities/project.entity';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  // Literal route declared before parametric `:projectId` to avoid
  // ParseIntPipe trying to coerce "deleted" into a number.
  @Get('deleted')
  @Roles(Role.ADMIN)
  findDeleted(): Promise<Project[]> {
    return this.projects.findDeleted();
  }

  @Get()
  findAll(): Promise<Project[]> {
    return this.projects.findAll();
  }

  @Get(':projectId')
  findOne(
    @Param('projectId', ParseIntPipe) projectId: number,
  ): Promise<Project> {
    return this.projects.findOne(projectId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  create(
    @Body() dto: CreateProjectDto,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<Project> {
    return this.projects.create(dto, {
      actor: AuditActor.USER,
      performedBy: me.userId,
    });
  }

  @Post(':projectId/restore')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async restore(
    @Param('projectId', ParseIntPipe) projectId: number,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<void> {
    await this.projects.restore(projectId, {
      actor: AuditActor.USER,
      performedBy: me.userId,
    });
  }

  @Patch(':projectId')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<void> {
    await this.projects.update(projectId, dto, {
      actor: AuditActor.USER,
      performedBy: me.userId,
    });
  }

  @Delete(':projectId')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('projectId', ParseIntPipe) projectId: number,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<void> {
    await this.projects.softDelete(projectId, {
      actor: AuditActor.USER,
      performedBy: me.userId,
    });
  }
}
