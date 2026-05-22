import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { Ticket } from '../tickets/entities/ticket.entity';
import { EscalationService } from './escalation.service';

@Module({
  imports: [TypeOrmModule.forFeature([Ticket]), AuditLogModule],
  providers: [EscalationService],
  exports: [EscalationService],
})
export class EscalationModule {}
