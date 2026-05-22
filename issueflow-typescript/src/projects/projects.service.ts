import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
  ) {}

  async create(dto: CreateProjectDto): Promise<Project> {
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
    return this.projects.save(project);
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

  async update(id: number, dto: UpdateProjectDto): Promise<Project> {
    const project = await this.findOne(id);
    if (dto.name !== undefined) project.name = dto.name;
    if (dto.description !== undefined) project.description = dto.description;
    return this.projects.save(project);
  }

  async softDelete(id: number): Promise<void> {
    const result = await this.projects.softDelete(id);
    if (!result.affected) {
      throw new NotFoundException(`Project ${id} not found`);
    }
  }
}
