import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { rm } from 'node:fs/promises';
import { Repository } from 'typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/enums/audit-action.enum';
import { AuditEntityType } from '../audit-log/enums/audit-entity-type.enum';
import { AuditContext } from '../audit-log/interfaces/audit-context.interface';
import { TicketsService } from '../tickets/tickets.service';
import { Attachment } from './entities/attachment.entity';
import { sanitizeFilename } from './multer-options';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  path: string;
}

@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);

  constructor(
    @InjectRepository(Attachment)
    private readonly attachments: Repository<Attachment>,
    private readonly tickets: TicketsService,
    private readonly audit: AuditLogService,
  ) {}

  async create(
    ticketId: number,
    file: UploadedFile,
    uploadedById: number,
    ctx?: AuditContext,
  ): Promise<Attachment> {
    await this.tickets.findOne(ticketId);

    const saved = await this.attachments.save(
      this.attachments.create({
        ticketId,
        filename: sanitizeFilename(file.originalname),
        contentType: file.mimetype,
        sizeBytes: file.size,
        storagePath: file.path,
        uploadedById,
      }),
    );

    if (ctx) {
      await this.audit.record({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.ATTACHMENT,
        entityId: saved.id,
        actor: ctx.actor,
        performedBy: ctx.performedBy,
        payload: {
          ticketId: saved.ticketId,
          filename: saved.filename,
          contentType: saved.contentType,
          sizeBytes: saved.sizeBytes,
        },
      });
    }
    return saved;
  }

  async remove(
    ticketId: number,
    attachmentId: number,
    ctx?: AuditContext,
  ): Promise<void> {
    const attachment = await this.attachments.findOne({
      where: { id: attachmentId, ticketId },
    });
    if (!attachment) {
      throw new NotFoundException(
        `Attachment ${attachmentId} not found in ticket ${ticketId}`,
      );
    }
    // Best-effort disk removal; swallow if file already gone.
    await rm(attachment.storagePath).catch((err) => {
      this.logger.warn(
        `Failed to remove file ${attachment.storagePath}: ${(err as Error).message}`,
      );
    });
    await this.attachments.delete(attachment.id);

    if (ctx) {
      await this.audit.record({
        action: AuditAction.DELETE,
        entityType: AuditEntityType.ATTACHMENT,
        entityId: attachment.id,
        actor: ctx.actor,
        performedBy: ctx.performedBy,
        payload: { filename: attachment.filename },
      });
    }
  }
}
