import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { AuditActor } from '../audit-log/enums/audit-actor.enum';
import { BlockerSummary, DependenciesService } from './dependencies.service';
import { AddDependencyDto } from './dto/add-dependency.dto';

@Controller('tickets/:ticketId/dependencies')
export class DependenciesController {
  constructor(private readonly deps: DependenciesService) {}

  @Get()
  list(
    @Param('ticketId', ParseIntPipe) ticketId: number,
  ): Promise<BlockerSummary[]> {
    return this.deps.listBlockers(ticketId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async add(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Body() dto: AddDependencyDto,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<void> {
    await this.deps.add(ticketId, dto.blockedBy, {
      actor: AuditActor.USER,
      performedBy: me.userId,
    });
  }

  @Delete(':blockerId')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Param('blockerId', ParseIntPipe) blockerId: number,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<void> {
    await this.deps.remove(ticketId, blockerId, {
      actor: AuditActor.USER,
      performedBy: me.userId,
    });
  }
}
