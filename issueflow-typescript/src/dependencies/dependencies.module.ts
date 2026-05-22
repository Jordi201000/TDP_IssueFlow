import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { TicketsModule } from '../tickets/tickets.module';
import { DependenciesController } from './dependencies.controller';
import { DependenciesService } from './dependencies.service';
import { TicketDependency } from './entities/ticket-dependency.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([TicketDependency]),
    TicketsModule,
    AuditLogModule,
  ],
  controllers: [DependenciesController],
  providers: [DependenciesService],
  exports: [DependenciesService],
})
export class DependenciesModule {}
