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
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { Ticket } from './entities/ticket.entity';
import { parseIfMatch } from './helpers/if-match';
import { EtagInterceptor } from './interceptors/etag.interceptor';
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
  create(@Body() dto: CreateTicketDto): Promise<Ticket> {
    return this.tickets.create(dto);
  }

  @Patch(':ticketId')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Body() dto: UpdateTicketDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const expectedVersion = parseIfMatch(ifMatch);
    const updated = await this.tickets.update(ticketId, dto, expectedVersion);
    res.setHeader('ETag', `"${updated.version}"`);
  }

  @Delete(':ticketId')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('ticketId', ParseIntPipe) ticketId: number,
  ): Promise<void> {
    await this.tickets.softDelete(ticketId);
  }
}
