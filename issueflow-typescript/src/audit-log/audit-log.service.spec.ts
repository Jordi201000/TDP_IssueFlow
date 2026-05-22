import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogService } from './audit-log.service';
import { AuditLog } from './entities/audit-log.entity';
import { AuditAction } from './enums/audit-action.enum';
import { AuditActor } from './enums/audit-actor.enum';
import { AuditEntityType } from './enums/audit-entity-type.enum';

function makeRepo(): jest.Mocked<Repository<AuditLog>> {
  return {
    create: jest.fn((data: Partial<AuditLog>) => ({ ...data }) as AuditLog),
    save: jest.fn(),
    find: jest.fn(),
  } as unknown as jest.Mocked<Repository<AuditLog>>;
}

describe('AuditLogService', () => {
  let service: AuditLogService;
  let repo: jest.Mocked<Repository<AuditLog>>;

  beforeEach(async () => {
    repo = makeRepo();
    const module = await Test.createTestingModule({
      providers: [
        AuditLogService,
        { provide: getRepositoryToken(AuditLog), useValue: repo },
      ],
    }).compile();
    service = module.get(AuditLogService);
  });

  const entry = {
    action: AuditAction.CREATE,
    entityType: AuditEntityType.USER,
    entityId: 1,
    actor: AuditActor.USER,
    performedBy: 1,
  };

  it('persists the entry with payload defaulted to null', async () => {
    repo.save.mockResolvedValueOnce({} as AuditLog);
    await service.record(entry);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ ...entry, payload: null }),
    );
    expect(repo.save).toHaveBeenCalled();
  });

  it('swallows errors from save', async () => {
    repo.save.mockRejectedValueOnce(new Error('db down'));
    await expect(service.record(entry)).resolves.toBeUndefined();
  });

  it('findAll with no filter returns all, ordered DESC by timestamp+id', async () => {
    const list = [{ id: 2 } as AuditLog, { id: 1 } as AuditLog];
    repo.find.mockResolvedValueOnce(list);
    await expect(service.findAll({})).resolves.toBe(list);
    expect(repo.find).toHaveBeenCalledWith({
      where: {},
      order: { timestamp: 'DESC', id: 'DESC' },
    });
  });

  it('findAll narrows by entityType', async () => {
    repo.find.mockResolvedValueOnce([]);
    await service.findAll({ entityType: AuditEntityType.TICKET });
    expect(repo.find).toHaveBeenCalledWith({
      where: { entityType: AuditEntityType.TICKET },
      order: { timestamp: 'DESC', id: 'DESC' },
    });
  });

  it.each([
    ['entityId', { entityId: 5 }],
    ['action', { action: AuditAction.UPDATE }],
    ['actor', { actor: AuditActor.SYSTEM }],
  ])('findAll narrows by %s', async (_label, filter) => {
    repo.find.mockResolvedValueOnce([]);
    await service.findAll(filter);
    expect(repo.find).toHaveBeenCalledWith({
      where: filter,
      order: { timestamp: 'DESC', id: 'DESC' },
    });
  });
});
