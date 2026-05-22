import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { QueryFailedError, Repository } from 'typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/enums/audit-action.enum';
import { AuditEntityType } from '../audit-log/enums/audit-entity-type.enum';
import { AuditContext } from '../audit-log/interfaces/audit-context.interface';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly audit: AuditLogService,
  ) {}

  async create(dto: CreateUserDto, ctx?: AuditContext): Promise<User> {
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = this.users.create({
      username: dto.username,
      email: dto.email,
      fullName: dto.fullName,
      role: dto.role,
      passwordHash,
    });

    let saved: User;
    try {
      saved = await this.users.save(user);
    } catch (err) {
      const field = this.detectUniqueViolation(err);
      if (field) {
        throw new ConflictException(`${field} already exists`);
      }
      throw err;
    }

    if (ctx) {
      await this.audit.record({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.USER,
        entityId: saved.id,
        actor: ctx.actor,
        performedBy: ctx.performedBy,
        payload: {
          snapshot: {
            id: saved.id,
            username: saved.username,
            email: saved.email,
            fullName: saved.fullName,
            role: saved.role,
          },
        },
      });
    }
    return saved;
  }

  findAll(): Promise<User[]> {
    return this.users.find();
  }

  findByUsername(username: string): Promise<User | null> {
    return this.users.findOne({ where: { username } });
  }

  async findOne(id: number): Promise<User> {
    const user = await this.users.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  async update(
    id: number,
    dto: UpdateUserDto,
    ctx?: AuditContext,
  ): Promise<User> {
    const user = await this.findOne(id);
    if (dto.fullName !== undefined) user.fullName = dto.fullName;
    if (dto.role !== undefined) user.role = dto.role;
    const saved = await this.users.save(user);

    if (ctx) {
      await this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.USER,
        entityId: saved.id,
        actor: ctx.actor,
        performedBy: ctx.performedBy,
        payload: { changes: dto },
      });
    }
    return saved;
  }

  async remove(id: number, ctx?: AuditContext): Promise<void> {
    const result = await this.users.delete(id);
    if (!result.affected) {
      throw new NotFoundException(`User ${id} not found`);
    }
    if (ctx) {
      await this.audit.record({
        action: AuditAction.DELETE,
        entityType: AuditEntityType.USER,
        entityId: id,
        actor: ctx.actor,
        performedBy: ctx.performedBy,
      });
    }
  }

  private detectUniqueViolation(err: unknown): 'username' | 'email' | null {
    if (!(err instanceof QueryFailedError)) return null;
    const driver = (err as QueryFailedError & { driverError?: any }).driverError ?? {};
    const code: string | undefined = driver.code;

    const uniqueCodes = new Set([
      '23505',
      'SQLITE_CONSTRAINT_UNIQUE',
      'ER_DUP_ENTRY',
    ]);
    if (!code || !uniqueCodes.has(code)) return null;

    const haystack = `${driver.detail ?? ''} ${driver.message ?? ''} ${err.message}`.toLowerCase();
    if (haystack.includes('username')) return 'username';
    if (haystack.includes('email')) return 'email';
    return null;
  }
}
