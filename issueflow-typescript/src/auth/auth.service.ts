import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AppConfig } from '../config/configuration';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';

export interface LoginResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.users.findByUsername(dto.username);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const expiresIn = this.config.get<AppConfig['jwt']>('jwt')!.ttlSeconds;
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, username: user.username, role: user.role },
      { expiresIn },
    );
    return { accessToken, tokenType: 'Bearer', expiresIn };
  }
}
