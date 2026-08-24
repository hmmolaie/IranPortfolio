import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async register(email: string, password: string, name?: string) {
    const existing = await this.users.findByEmail(email);
    if (existing) throw new ConflictException('این ایمیل قبلاً ثبت شده است');
    const user = await this.users.create(email, password, name);
    return this.tokenFor(user.id, user.email);
  }

  async login(email: string, password: string) {
    const user = await this.users.findByEmail(email);
    if (!user) throw new UnauthorizedException('ایمیل یا رمز عبور نادرست است');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('ایمیل یا رمز عبور نادرست است');
    return this.tokenFor(user.id, user.email);
  }

  private tokenFor(userId: string, email: string) {
    const accessToken = this.jwt.sign({ sub: userId, email });
    return { accessToken, user: { id: userId, email } };
  }
}
