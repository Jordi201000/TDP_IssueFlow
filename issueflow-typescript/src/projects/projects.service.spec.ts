import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { Role } from '../common/enums/role.enum';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { Project } from './entities/project.entity';
import { ProjectsService } from './projects.service';

function makeRepo(): jest.Mocked<Repository<Project>> {
  return {
    create: jest.fn((data: Partial<Project>) => ({ ...data }) as Project),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    softDelete: jest.fn(),
    restore: jest.fn(),
  } as unknown as jest.Mocked<Repository<Project>>;
}

describe('ProjectsService', () => {
  let service: ProjectsService;
  let repo: jest.Mocked<Repository<Project>>;
  let users: jest.Mocked<Pick<UsersService, 'findOne'>>;
  let audit: { record: jest.Mock };

  const ownerUser = { id: 1, username: 'owner', role: Role.ADMIN } as User;
  const validDto: CreateProjectDto = {
    name: 'Sample Project',
    description: 'A sample project',
    ownerId: 1,
  };

  beforeEach(async () => {
    repo = makeRepo();
    users = { findOne: jest.fn() };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: getRepositoryToken(Project), useValue: repo },
        { provide: UsersService, useValue: users },
        { provide: AuditLogService, useValue: audit },
      ],
    }).compile();
    service = module.get(ProjectsService);
  });

  describe('create', () => {
    it('persists project when owner exists', async () => {
      users.findOne.mockResolvedValueOnce(ownerUser);
      repo.save.mockImplementation(async (p) => ({ ...(p as Project), id: 42 }));

      const result = await service.create(validDto);

      expect(result.id).toBe(42);
      expect(result.name).toBe(validDto.name);
      expect(result.ownerId).toBe(1);
      expect(users.findOne).toHaveBeenCalledWith(1);
    });

    it('throws BadRequestException when owner does not exist', async () => {
      users.findOne.mockRejectedValueOnce(new NotFoundException());
      const err = await service.create(validDto).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toMatch(/Owner user 1 does not exist/);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('findAll / findOne', () => {
    it('findAll returns the repository result', async () => {
      const list = [{ id: 1 } as Project];
      repo.find.mockResolvedValueOnce(list);
      await expect(service.findAll()).resolves.toBe(list);
    });

    it('findOne returns when found', async () => {
      const project = { id: 5 } as Project;
      repo.findOne.mockResolvedValueOnce(project);
      await expect(service.findOne(5)).resolves.toBe(project);
    });

    it('findOne throws NotFoundException when missing or soft-deleted', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('applies only name and description', async () => {
      const existing = {
        id: 1,
        name: 'old',
        description: 'old desc',
        ownerId: 1,
      } as Project;
      repo.findOne.mockResolvedValueOnce(existing);
      repo.save.mockImplementation(async (p) => p as Project);

      const result = await service.update(1, {
        name: 'New',
        description: 'New desc',
      });

      expect(result.name).toBe('New');
      expect(result.description).toBe('New desc');
      expect(result.ownerId).toBe(1);
    });

    it('throws NotFoundException when missing', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      await expect(service.update(99, { name: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('softDelete', () => {
    it('calls repo.softDelete with the id', async () => {
      repo.softDelete.mockResolvedValueOnce({ affected: 1, raw: {} } as never);
      await service.softDelete(1);
      expect(repo.softDelete).toHaveBeenCalledWith(1);
    });

    it('throws NotFoundException when nothing was deleted', async () => {
      repo.softDelete.mockResolvedValueOnce({ affected: 0, raw: {} } as never);
      await expect(service.softDelete(1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findDeleted / restore (Phase 10)', () => {
    it('findDeleted queries with withDeleted', async () => {
      const list = [{ id: 1 } as Project];
      repo.find.mockResolvedValueOnce(list);
      await expect(service.findDeleted()).resolves.toBe(list);
      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({ withDeleted: true }),
      );
    });

    it('restore calls repo.restore and emits a RESTORE audit row when ctx is supplied', async () => {
      repo.restore.mockResolvedValueOnce({ affected: 1, raw: {} } as never);
      await service.restore(1, { actor: 'USER' as never, performedBy: 99 });
      expect(repo.restore).toHaveBeenCalledWith(1);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'RESTORE',
          entityType: 'PROJECT',
          entityId: 1,
          performedBy: 99,
        }),
      );
    });

    it('restore throws NotFoundException on affected:0', async () => {
      repo.restore.mockResolvedValueOnce({ affected: 0, raw: {} } as never);
      await expect(service.restore(99)).rejects.toThrow(NotFoundException);
    });

    it('restore skips audit when ctx omitted', async () => {
      repo.restore.mockResolvedValueOnce({ affected: 1, raw: {} } as never);
      await service.restore(1);
      expect(audit.record).not.toHaveBeenCalled();
    });
  });
});
