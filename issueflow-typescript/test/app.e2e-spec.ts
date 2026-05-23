import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { rm } from 'node:fs/promises';
import * as request from 'supertest';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

jest.setTimeout(30000);

describe('App e2e', () => {
  let app: INestApplication;
  let http: any;

  let adminToken: string;
  let devToken: string;
  let adminId: number;
  let devId: number;
  let secondDevId: number;
  let mentionedUserId: number;

  const unique = Date.now();

  const auth = (token: string) => `Bearer ${token}`;

  async function createUser(
    username: string,
    role: 'ADMIN' | 'DEVELOPER',
  ): Promise<number> {
    const res = await request(http)
      .post('/users')
      .send({
        username,
        email: `${username}@example.com`,
        fullName: username,
        role,
        password: 'secret123',
      })
      .expect(200);
    return res.body.id;
  }

  async function login(username: string): Promise<string> {
    const res = await request(http)
      .post('/auth/login')
      .send({ username, password: 'secret123' })
      .expect(200);
    expect(res.body).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: expect.any(Number),
    });
    expect(res.body.accessToken).toEqual(expect.any(String));
    return res.body.accessToken;
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const { AppModule } = await import('../src/app.module');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(
      new ClassSerializerInterceptor(app.get(Reflector)),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    http = app.getHttpServer();

    adminId = await createUser(`admin_${unique}`, 'ADMIN');
    devId = await createUser(`dev_${unique}`, 'DEVELOPER');
    secondDevId = await createUser(`dev2_${unique}`, 'DEVELOPER');
    mentionedUserId = await createUser(`mention_${unique}`, 'DEVELOPER');

    adminToken = await login(`admin_${unique}`);
    devToken = await login(`dev_${unique}`);
  });

  afterAll(async () => {
    await rm('uploads', { recursive: true, force: true });
    if (app) {
      await app.close();
    }
  });

  it('GET /health returns ok', async () => {
    await request(http)
      .get('/health')
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe('ok');
      });
  });

  it('supports auth/me and invalidates tokens on logout', async () => {
    await request(http)
      .get('/auth/me')
      .set('Authorization', auth(devToken))
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          id: devId,
          username: `dev_${unique}`,
          role: 'DEVELOPER',
        });
        expect(res.body.passwordHash).toBeUndefined();
      });

    await request(http)
      .post('/auth/logout')
      .set('Authorization', auth(devToken))
      .expect(200);

    await request(http)
      .get('/auth/me')
      .set('Authorization', auth(devToken))
      .expect(401);

    devToken = await login(`dev_${unique}`);
  });

  it('rejects tokens after their user is deleted', async () => {
    const username = `deleted_${unique}`;
    const deletedUserId = await createUser(username, 'DEVELOPER');
    const deletedUserToken = await login(username);

    await request(http)
      .delete(`/users/${deletedUserId}`)
      .set('Authorization', auth(adminToken))
      .expect(200);

    await request(http)
      .get('/projects')
      .set('Authorization', auth(deletedUserToken))
      .expect(401);
  });

  it('covers projects, tickets, comments, mentions, dependencies, attachments, CSV, audit, workload, and soft delete', async () => {
    const project = await request(http)
      .post('/projects')
      .set('Authorization', auth(adminToken))
      .send({
        name: `Project ${unique}`,
        description: 'E2E project',
        ownerId: devId,
      })
      .expect(200)
      .then((res) => res.body);

    await request(http)
      .get('/users')
      .set('Authorization', auth(adminToken))
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: adminId,
              username: `admin_${unique}`,
            }),
          ]),
        );
      });

    await request(http)
      .post(`/users/update/${secondDevId}`)
      .set('Authorization', auth(adminToken))
      .send({ fullName: 'Second Developer' })
      .expect(200);

    await request(http)
      .get(`/users/${secondDevId}`)
      .set('Authorization', auth(adminToken))
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          id: secondDevId,
          fullName: 'Second Developer',
        });
      });

    await request(http)
      .get(`/projects/${project.id}`)
      .set('Authorization', auth(adminToken))
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          id: project.id,
          ownerId: devId,
        });
      });

    await request(http)
      .patch(`/projects/${project.id}`)
      .set('Authorization', auth(adminToken))
      .send({ description: 'Updated E2E project' })
      .expect(200);

    await request(http)
      .get(`/projects/${project.id}`)
      .set('Authorization', auth(adminToken))
      .expect(200)
      .expect((res) => {
        expect(res.body.description).toBe('Updated E2E project');
      });

    const ticketRes = await request(http)
      .post('/tickets')
      .set('Authorization', auth(adminToken))
      .send({
        title: 'Primary ticket',
        description: 'Needs blocker',
        status: 'TODO',
        priority: 'LOW',
        type: 'BUG',
        projectId: project.id,
      })
      .expect(200);
    const ticket = ticketRes.body;
    expect(ticket.assigneeId).toBe(devId);
    expect(ticketRes.headers.etag).toBe('"1"');

    await request(http)
      .get(`/tickets?projectId=${project.id}`)
      .set('Authorization', auth(adminToken))
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual([
          expect.objectContaining({ id: ticket.id }),
        ]);
      });

    await request(http)
      .get(`/tickets/${ticket.id}`)
      .set('Authorization', auth(adminToken))
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          id: ticket.id,
          projectId: project.id,
          assigneeId: devId,
        });
      });

    const blockerRes = await request(http)
      .post('/tickets')
      .set('Authorization', auth(adminToken))
      .send({
        title: 'Blocking ticket',
        description: 'Must finish first',
        status: 'TODO',
        priority: 'MEDIUM',
        type: 'TECHNICAL',
        projectId: project.id,
        assigneeId: secondDevId,
      })
      .expect(200);
    const blocker = blockerRes.body;

    await request(http)
      .post(`/tickets/${ticket.id}/dependencies`)
      .set('Authorization', auth(adminToken))
      .send({ blockedBy: blocker.id })
      .expect(200);

    await request(http)
      .get(`/tickets/${ticket.id}/dependencies`)
      .set('Authorization', auth(adminToken))
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual([
          expect.objectContaining({
            id: blocker.id,
            title: 'Blocking ticket',
            status: 'TODO',
          }),
        ]);
      });

    await request(http)
      .patch(`/tickets/${ticket.id}`)
      .set('Authorization', auth(adminToken))
      .set('If-Match', ticketRes.headers.etag)
      .send({ status: 'DONE' })
      .expect(400);

    const doneBlockerRes = await request(http)
      .patch(`/tickets/${blocker.id}`)
      .set('Authorization', auth(adminToken))
      .set('If-Match', blockerRes.headers.etag)
      .send({ status: 'DONE' })
      .expect(200);
    expect(doneBlockerRes.headers.etag).toBe('"2"');

    const updatedTicketRes = await request(http)
      .patch(`/tickets/${ticket.id}`)
      .set('Authorization', auth(adminToken))
      .set('If-Match', ticketRes.headers.etag)
      .send({ status: 'IN_PROGRESS', priority: 'HIGH' })
      .expect(200);
    expect(updatedTicketRes.headers.etag).toBe('"2"');

    const commentRes = await request(http)
      .post(`/tickets/${ticket.id}/comments`)
      .set('Authorization', auth(adminToken))
      .send({
        authorId: secondDevId,
        content: `Hello @mention_${unique}`,
      })
      .expect(200);
    const comment = commentRes.body;
    expect(comment.mentionedUsers).toEqual([
      expect.objectContaining({
        id: mentionedUserId,
        username: `mention_${unique}`,
      }),
    ]);

    await request(http)
      .get(`/users/${mentionedUserId}/mentions`)
      .set('Authorization', auth(adminToken))
      .expect(200)
      .expect((res) => {
        expect(res.body.total).toBe(1);
        expect(res.body.data[0]).toMatchObject({
          id: comment.id,
          ticketId: ticket.id,
          authorId: secondDevId,
        });
      });

    const updatedCommentRes = await request(http)
      .patch(`/tickets/${ticket.id}/comments/${comment.id}`)
      .set('Authorization', auth(adminToken))
      .set('If-Match', commentRes.headers.etag)
      .send({ content: 'Updated comment' })
      .expect(200);
    expect(updatedCommentRes.headers.etag).toBe('"2"');

    await request(http)
      .get(`/tickets/${ticket.id}/comments`)
      .set('Authorization', auth(adminToken))
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual([
          expect.objectContaining({
            id: comment.id,
            content: 'Updated comment',
            mentionedUsers: [],
          }),
        ]);
      });

    await request(http)
      .delete(`/tickets/${ticket.id}/comments/${comment.id}`)
      .set('Authorization', auth(adminToken))
      .expect(200);

    await request(http)
      .get(`/tickets/${ticket.id}/comments`)
      .set('Authorization', auth(adminToken))
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual([]);
      });

    const attachment = await request(http)
      .post(`/tickets/${ticket.id}/attachments`)
      .set('Authorization', auth(adminToken))
      .attach('file', Buffer.from('hello'), {
        filename: 'note.txt',
        contentType: 'text/plain',
      })
      .expect(200)
      .then((res) => res.body);
    expect(attachment).toMatchObject({
      ticketId: ticket.id,
      filename: 'note.txt',
      contentType: 'text/plain',
    });

    await request(http)
      .delete(`/tickets/${ticket.id}/attachments/${attachment.id}`)
      .set('Authorization', auth(adminToken))
      .expect(200);

    await request(http)
      .get(`/projects/${project.id}/workload`)
      .set('Authorization', auth(adminToken))
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              userId: devId,
              username: `dev_${unique}`,
              openTicketCount: 1,
            }),
            expect.objectContaining({
              userId: secondDevId,
              username: `dev2_${unique}`,
              openTicketCount: 0,
            }),
          ]),
        );
      });

    await request(http)
      .delete(`/tickets/${ticket.id}/dependencies/${blocker.id}`)
      .set('Authorization', auth(adminToken))
      .expect(200);

    await request(http)
      .get(`/tickets/${ticket.id}/dependencies`)
      .set('Authorization', auth(adminToken))
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual([]);
      });

    await request(http)
      .get(`/tickets/export?projectId=${project.id}`)
      .set('Authorization', auth(adminToken))
      .expect(200)
      .expect((res) => {
        expect(res.text).toContain(
          'id,title,description,status,priority,type,assigneeId',
        );
        expect(res.text).toContain('Primary ticket');
      });

    await request(http)
      .post('/tickets/import')
      .set('Authorization', auth(adminToken))
      .field('projectId', String(project.id))
      .attach(
        'file',
        Buffer.from(
          'id,title,description,status,priority,type,assigneeId\n,Imported,From CSV,TODO,LOW,FEATURE,\n',
        ),
        {
          filename: 'tickets.csv',
          contentType: 'text/csv',
        },
      )
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          created: 1,
          failed: 0,
          errors: [],
        });
      });

    await request(http)
      .get('/audit-logs?action=CREATE')
      .set('Authorization', auth(adminToken))
      .expect(200)
      .expect((res) => {
        expect(res.body.length).toBeGreaterThan(0);
      });

    await request(http)
      .get('/audit-logs?action=CREATE&actor=USER')
      .set('Authorization', auth(adminToken))
      .expect(400);

    await request(http)
      .delete(`/tickets/${ticket.id}`)
      .set('Authorization', auth(adminToken))
      .expect(200);

    await request(http)
      .get(`/tickets/deleted?projectId=${project.id}`)
      .set('Authorization', auth(adminToken))
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual([
          expect.objectContaining({ id: ticket.id }),
        ]);
      });

    await request(http)
      .post(`/tickets/${ticket.id}/restore`)
      .set('Authorization', auth(adminToken))
      .expect(200);

    await request(http)
      .delete(`/projects/${project.id}`)
      .set('Authorization', auth(adminToken))
      .expect(200);

    await request(http)
      .get('/projects/deleted')
      .set('Authorization', auth(adminToken))
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual([
          expect.objectContaining({ id: project.id }),
        ]);
      });

    await request(http)
      .post(`/projects/${project.id}/restore`)
      .set('Authorization', auth(adminToken))
      .expect(200);
  });
});
