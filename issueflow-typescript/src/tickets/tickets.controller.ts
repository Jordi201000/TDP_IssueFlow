import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { AuditActor } from '../audit-log/enums/audit-actor.enum';
import { parseIfMatch } from '../common/helpers/if-match';
import { EtagInterceptor } from '../common/interceptors/etag.interceptor';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { Ticket } from './entities/ticket.entity';
import { TicketsService } from './tickets.service';

@Controller('tickets')
@UseInterceptors(EtagInterceptor)
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  findAllByProject(
    @Query('projectId', ParseIntPipe) projectId: number,
  ): Promise<Ticket[]> {
    return this.tickets.findAllByProject(projectId);
  }

  @Get(':ticketId')
  findOne(
    @Param('ticketId', ParseIntPipe) ticketId: number,
  ): Promise<Ticket> {
    return this.tickets.findOne(ticketId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  create(
    @Body() dto: CreateTicketDto,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<Ticket> {
    return this.tickets.create(dto, {
      actor: AuditActor.USER,
      performedBy: me.userId,
    });
  }

  @Patch(':ticketId')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Body() dto: UpdateTicketDto,
    @Headers('if-match') ifMatch: string | undefined,
    @CurrentUser() me: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const expectedVersion = parseIfMatch(ifMatch);
    const updated = await this.tickets.update(ticketId, dto, expectedVersion, {
      actor: AuditActor.USER,
      performedBy: me.userId,
    });
    res.setHeader('ETag', `"${updated.version}"`);
  }

  @Delete(':ticketId')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<void> {
    await this.tickets.softDelete(ticketId, {
      actor: AuditActor.USER,
      performedBy: me.userId,
    });
  }
}
