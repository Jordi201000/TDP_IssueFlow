import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { AuditLog } from './entities/audit-log.entity';

@Controller('audit-logs')
export class AuditLogController {
  constructor(private readonly logs: AuditLogService) {}

  @Get()
  findAll(@Query() query: AuditLogQueryDto): Promise<AuditLog[]> {
    const provided = [
      query.entityType,
      query.entityId,
      query.action,
      query.actor,
    ].filter((v) => v !== undefined).length;
    if (provided > 1) {
      throw new BadRequestException(
        'At most one filter is allowed: entityType, entityId, action, or actor',
      );
    }
    return this.logs.findAll(query);
  }
}
