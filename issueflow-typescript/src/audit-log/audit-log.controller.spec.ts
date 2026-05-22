import { BadRequestException } from '@nestjs/common';
import { AuditLogController } from './audit-log.controller';
import { AuditLogService } from './audit-log.service';
import { AuditAction } from './enums/audit-action.enum';
import { AuditActor } from './enums/audit-actor.enum';
import { AuditEntityType } from './enums/audit-entity-type.enum';

describe('AuditLogController', () => {
  let controller: AuditLogController;
  let service: jest.Mocked<Pick<AuditLogService, 'findAll'>>;

  beforeEach(() => {
    service = { findAll: jest.fn().mockResolvedValue([]) };
    controller = new AuditLogController(service as unknown as AuditLogService);
  });

  it('passes empty filter through', async () => {
    await controller.findAll({});
    expect(service.findAll).toHaveBeenCalledWith({});
  });

  it('passes single filter through', async () => {
    await controller.findAll({ entityType: AuditEntityType.TICKET });
    expect(service.findAll).toHaveBeenCalledWith({
      entityType: AuditEntityType.TICKET,
    });
  });

  it('rejects multiple filters with BadRequestException', () => {
    expect(() =>
      controller.findAll({
        action: AuditAction.CREATE,
        actor: AuditActor.USER,
      }),
    ).toThrow(BadRequestException);
    expect(service.findAll).not.toHaveBeenCalled();
  });
});
