import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as fs from 'node:fs/promises';
import { Repository } from 'typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/enums/audit-action.enum';
import { AuditActor } from '../audit-log/enums/audit-actor.enum';
import { AuditEntityType } from '../audit-log/enums/audit-entity-type.enum';
import { Ticket } from '../tickets/entities/ticket.entity';
import { TicketsService } from '../tickets/tickets.service';
import { AttachmentsService, UploadedFile } from './attachments.service';
import { Attachment } from './entities/attachment.entity';

function makeRepo(): jest.Mocked<Repository<Attachment>> {
  return {
    create: jest.fn((data: Partial<Attachment>) => ({ ...data }) as Attachment),
    save: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
  } as unknown as jest.Mocked<Repository<Attachment>>;
}

describe('AttachmentsService', () => {
  let service: AttachmentsService;
  let repo: jest.Mocked<Repository<Attachment>>;
  let tickets: jest.Mocked<Pick<TicketsService, 'findOne'>>;
  let audit: { record: jest.Mock };

  beforeEach(async () => {
    repo = makeRepo();
    tickets = { findOne: jest.fn() };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [
        AttachmentsService,
        { provide: getRepositoryToken(Attachment), useValue: repo },
        { provide: TicketsService, useValue: tickets },
        { provide: AuditLogService, useValue: audit },
      ],
    }).compile();
    service = module.get(AttachmentsService);
  });

  const validFile: UploadedFile = {
    originalname: 'screenshot.png',
    mimetype: 'image/png',
    size: 1024,
    path: 'uploads/1/abc-screenshot.png',
  };

  describe('create', () => {
    it('validates ticket, persists, and emits CREATE audit', async () => {
      tickets.findOne.mockResolvedValueOnce({ id: 1 } as Ticket);
      repo.save.mockImplementation(async (a) => ({ ...(a as Attachment), id: 7 }));

      const result = await service.create(1, validFile, 99, {
        actor: AuditActor.USER,
        performedBy: 99,
      });

      expect(result.id).toBe(7);
      expect(result.filename).toBe('screenshot.png');
      expect(result.contentType).toBe('image/png');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.CREATE,
          entityType: AuditEntityType.ATTACHMENT,
          entityId: 7,
          performedBy: 99,
        }),
      );
    });

    it('propagates NotFoundException when ticket missing', async () => {
      tickets.findOne.mockRejectedValueOnce(new NotFoundException());
      await expect(
        service.create(99, validFile, 1),
      ).rejects.toThrow(NotFoundException);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes DB row + calls fs.rm + emits DELETE audit', async () => {
      const attachment = {
        id: 7,
        ticketId: 1,
        filename: 'a.png',
        storagePath: 'uploads/1/abc-a.png',
      } as Attachment;
      repo.findOne.mockResolvedValueOnce(attachment);
      const rmSpy = jest.spyOn(fs, 'rm').mockResolvedValueOnce(undefined as never);
      repo.delete.mockResolvedValueOnce({ affected: 1, raw: {} } as never);

      await service.remove(1, 7, { actor: AuditActor.USER, performedBy: 99 });

      expect(rmSpy).toHaveBeenCalledWith('uploads/1/abc-a.png');
      expect(repo.delete).toHaveBeenCalledWith(7);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.DELETE,
          entityType: AuditEntityType.ATTACHMENT,
          entityId: 7,
          payload: { filename: 'a.png' },
        }),
      );
    });

    it('swallows fs.rm errors (best-effort) and still deletes DB row', async () => {
      const attachment = {
        id: 7,
        ticketId: 1,
        filename: 'a.png',
        storagePath: 'uploads/1/abc-a.png',
      } as Attachment;
      repo.findOne.mockResolvedValueOnce(attachment);
      jest.spyOn(fs, 'rm').mockRejectedValueOnce(new Error('ENOENT'));
      repo.delete.mockResolvedValueOnce({ affected: 1, raw: {} } as never);

      await expect(service.remove(1, 7)).resolves.toBeUndefined();
      expect(repo.delete).toHaveBeenCalledWith(7);
    });

    it('throws NotFoundException when attachment not under ticket', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      await expect(service.remove(1, 99)).rejects.toThrow(NotFoundException);
    });
  });
});
