import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuditAction } from '../enums/audit-action.enum';
import { AuditActor } from '../enums/audit-actor.enum';
import { AuditEntityType } from '../enums/audit-entity-type.enum';
import { AuditLogQueryDto } from './audit-log-query.dto';

describe('AuditLogQueryDto', () => {
  it('accepts an empty query', async () => {
    const dto = plainToInstance(AuditLogQueryDto, {});
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts each valid enum field', async () => {
    const dto = plainToInstance(AuditLogQueryDto, {
      entityType: AuditEntityType.TICKET,
      action: AuditAction.UPDATE,
      actor: AuditActor.SYSTEM,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects unknown action value', async () => {
    const dto = plainToInstance(AuditLogQueryDto, { action: 'BOGUS' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('action');
  });

  it('coerces entityId string to integer', async () => {
    const dto = plainToInstance(AuditLogQueryDto, { entityId: '42' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.entityId).toBe(42);
  });
});
