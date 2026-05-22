import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { QueryFailedError, Repository } from 'typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/enums/audit-action.enum';
import { AuditActor } from '../audit-log/enums/audit-actor.enum';
import { AuditEntityType } from '../audit-log/enums/audit-entity-type.enum';
import { Role } from '../common/enums/role.enum';
import { CreateUserDto } from './dto/create-user.dto';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';

function makeRepo(): jest.Mocked<Repository<User>> {
  return {
    create: jest.fn((data: Partial<User>) => ({ ...data }) as User),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
  } as unknown as jest.Mocked<Repository<User>>;
}

function makeUniqueError(driver: { code: string; detail?: string; message?: string }) {
  const err = new QueryFailedError('insert', [], new Error('driver'));
  (err as unknown as { driverError: typeof driver }).driverError = driver;
  return err;
}

describe('UsersService', () => {
  let service: UsersService;
  let repo: jest.Mocked<Repository<User>>;
  let audit: { record: jest.Mock };

  const validDto: CreateUserDto = {
    username: 'jdoe',
    email: 'jdoe@example.com',
    fullName: 'John Doe',
    role: Role.DEVELOPER,
    password: 'sup3rSecret',
  };

  beforeEach(async () => {
    repo = makeRepo();
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repo },
        { provide: AuditLogService, useValue: audit },
      ],
    }).compile();
    service = module.get(UsersService);
  });

  describe('create', () => {
    it('hashes the password and persists', async () => {
      repo.save.mockImplementation(async (u) => ({ ...(u as User), id: 1 }));
      const result = await service.create(validDto);

      expect(result.id).toBe(1);
      expect(result.passwordHash).not.toBe(validDto.password);
      expect(await bcrypt.compare(validDto.password, result.passwordHash)).toBe(true);
    });

    it('throws ConflictException on Postgres unique-violation (username)', async () => {
      repo.save.mockRejectedValueOnce(
        makeUniqueError({
          code: '23505',
          detail: 'Key (username)=(jdoe) already exists.',
        }),
      );
      const err = await service.create(validDto).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toMatch(/username/);
    });

    it('throws ConflictException on SQLite unique-violation (email)', async () => {
      repo.save.mockRejectedValueOnce(
        makeUniqueError({
          code: 'SQLITE_CONSTRAINT_UNIQUE',
          message: 'UNIQUE constraint failed: users.email',
        }),
      );
      const err = await service.create(validDto).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toMatch(/email/);
    });

    it('rethrows non-unique QueryFailedError unchanged', async () => {
      const err = makeUniqueError({ code: 'something-else' });
      repo.save.mockRejectedValueOnce(err);
      await expect(service.create(validDto)).rejects.toBe(err);
    });
  });

  describe('findAll / findOne', () => {
    it('findAll returns repository result', async () => {
      const list = [{ id: 1 } as User];
      repo.find.mockResolvedValueOnce(list);
      await expect(service.findAll()).resolves.toBe(list);
    });

    it('findOne returns user when found', async () => {
      const user = { id: 5 } as User;
      repo.findOne.mockResolvedValueOnce(user);
      await expect(service.findOne(5)).resolves.toBe(user);
    });

    it('findOne throws NotFoundException when missing', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('applies only fullName and role; ignores any sneaky extras', async () => {
      const existing = {
        id: 1,
        fullName: 'old',
        role: Role.DEVELOPER,
        passwordHash: 'untouched',
      } as User;
      repo.findOne.mockResolvedValueOnce(existing);
      repo.save.mockImplementation(async (u) => u as User);

      const result = await service.update(1, {
        fullName: 'New',
        role: Role.ADMIN,
        ...({ password: 'leak' } as Record<string, unknown>),
      });

      expect(result.fullName).toBe('New');
      expect(result.role).toBe(Role.ADMIN);
      expect(result.passwordHash).toBe('untouched');
      expect((result as unknown as Record<string, unknown>).password).toBeUndefined();
    });

    it('throws NotFoundException when missing', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      await expect(service.update(99, { fullName: 'x' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when nothing was deleted', async () => {
      repo.delete.mockResolvedValueOnce({ affected: 0, raw: {} });
      await expect(service.remove(1)).rejects.toThrow(NotFoundException);
    });

    it('resolves when one row deleted', async () => {
      repo.delete.mockResolvedValueOnce({ affected: 1, raw: {} });
      await expect(service.remove(1)).resolves.toBeUndefined();
    });
  });

  describe('audit emission (spot-check)', () => {
    it('create(dto, ctx) calls audit.record with USER/CREATE for the new user id', async () => {
      repo.save.mockImplementation(async (u) => ({ ...(u as User), id: 42 }));
      await service.create(validDto, {
        actor: AuditActor.USER,
        performedBy: 7,
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.CREATE,
          entityType: AuditEntityType.USER,
          entityId: 42,
          actor: AuditActor.USER,
          performedBy: 7,
        }),
      );
    });

    it('create(dto) without ctx does NOT call audit.record', async () => {
      repo.save.mockImplementation(async (u) => ({ ...(u as User), id: 1 }));
      await service.create(validDto);
      expect(audit.record).not.toHaveBeenCalled();
    });
  });
});
