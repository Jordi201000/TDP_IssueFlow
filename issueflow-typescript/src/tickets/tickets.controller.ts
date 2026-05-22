import {
  BadRequestException,
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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { AuditActor } from '../audit-log/enums/audit-actor.enum';
import { parseIfMatch } from '../common/helpers/if-match';
import { EtagInterceptor } from '../common/interceptors/etag.interceptor';
import { ImportSummary } from './csv/ticket-csv';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { Ticket } from './entities/ticket.entity';
import { TicketsService } from './tickets.service';

@Controller('tickets')
@UseInterceptors(EtagInterceptor)
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  // NOTE: literal-path GETs/POSTs declared BEFORE parametric ':ticketId'
  // routes to keep Express's order-based router from treating "export" /
  // "import" as a ticketId.
  @Get('export')
  async exportCsv(
    @Query('projectId', ParseIntPipe) projectId: number,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const csv = await this.tickets.exportProject(projectId);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="tickets-project-${projectId}.csv"`,
    );
    return csv;
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async importCsv(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { projectId?: string },
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<ImportSummary> {
    if (!file) {
      throw new BadRequestException('Multipart "file" field is required');
    }
    const projectId = Number(body.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      throw new BadRequestException(
        'projectId form field is required and must be a positive integer',
      );
    }
    return this.tickets.importProject(projectId, file.buffer, {
      actor: AuditActor.USER,
      performedBy: me.userId,
    });
  }

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
