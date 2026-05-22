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
import { Public } from '../common/decorators/public.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  findAll(): Promise<User[]> {
    return this.users.findAll();
  }

  @Get(':userId')
  findOne(@Param('userId', ParseIntPipe) userId: number): Promise<User> {
    return this.users.findOne(userId);
  }

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  create(@Body() dto: CreateUserDto): Promise<User> {
    // Public registration: no token, performedBy is null.
    return this.users.create(dto, { actor: AuditActor.USER, performedBy: null });
  }

  @Post('update/:userId')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: UpdateUserDto,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<void> {
    await this.users.update(userId, dto, {
      actor: AuditActor.USER,
      performedBy: me.userId,
    });
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('userId', ParseIntPipe) userId: number,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<void> {
    await this.users.remove(userId, {
      actor: AuditActor.USER,
      performedBy: me.userId,
    });
  }
}
