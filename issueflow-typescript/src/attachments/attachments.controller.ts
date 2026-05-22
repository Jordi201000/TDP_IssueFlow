import {
  BadRequestException,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { AuditActor } from '../audit-log/enums/audit-actor.enum';
import { AttachmentsService } from './attachments.service';
import { Attachment } from './entities/attachment.entity';
import { MulterExceptionFilter } from './filters/multer-exception.filter';
import { attachmentMulterOptions } from './multer-options';

@Controller('tickets/:ticketId/attachments')
@UseFilters(MulterExceptionFilter)
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', attachmentMulterOptions))
  async upload(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<Attachment> {
    if (!file) {
      throw new BadRequestException(
        'Multipart "file" field is required',
      );
    }
    return this.attachments.create(ticketId, file, me.userId, {
      actor: AuditActor.USER,
      performedBy: me.userId,
    });
  }

  @Delete(':attachmentId')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Param('attachmentId', ParseIntPipe) attachmentId: number,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<void> {
    await this.attachments.remove(ticketId, attachmentId, {
      actor: AuditActor.USER,
      performedBy: me.userId,
    });
  }
}
