import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsPositive } from 'class-validator';
import { AuditAction } from '../enums/audit-action.enum';
import { AuditActor } from '../enums/audit-actor.enum';
import { AuditEntityType } from '../enums/audit-entity-type.enum';

export class AuditLogQueryDto {
  @IsOptional()
  @IsEnum(AuditEntityType)
  entityType?: AuditEntityType;

  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === null || value === '' ? undefined : Number(value),
  )
  @IsInt()
  @IsPositive()
  entityId?: number;

  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @IsOptional()
  @IsEnum(AuditActor)
  actor?: AuditActor;
}
