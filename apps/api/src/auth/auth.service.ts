import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { SessionsService, type SessionContext } from '../sessions/sessions.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly sessions: SessionsService,
  ) {}

  async register(email: string, password: string, name?: string) {
    const existing = await this.users.findByEmail(email);
    if (existing) throw new ConflictException('این ایمیل قبلاً ثبت شده است');
    const user = await this.users.create(email, password, name);
    return this.tokenFor(user.id, user.email, user.role ?? 'USER', await this.sessions.create(user.id));
  }

  async login(email: string, password: string, ctx: SessionContext = {}) {
    const user = await this.users.findByEmail(email);
    if (!user) throw new UnauthorizedException('نام کاربری و کلمه عبور اشتباه است');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('نام کاربری و کلمه عبور اشتباه است');
    if (!user.isActive) throw new UnauthorizedException('حساب کاربری غیرفعال است');
    const sid = await this.sessions.create(user.id, { ...ctx, method: 'password' });
    return this.tokenFor(user.id, user.email, user.role, sid);
  }

  /** همان نشست ادامه پیدا می‌کند؛ توکن قدیمی بدون sid یک نشست تازه می‌گیرد */
  async refresh(userId: string, sid?: string, ctx: SessionContext = {}) {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException('جلسه نامعتبر است');
    if (!user.isActive) throw new UnauthorizedException('حساب کاربری غیرفعال است');
    return this.tokenFor(user.id, user.email, user.role, sid ?? (await this.sessions.create(user.id, ctx)));
  }

  logout(userId: string, sid?: string) {
    if (!sid) return { ok: true };
    return this.sessions.end(sid, userId);
  }

  async sessionFor(
    user: { id: string; email: string; role: string; isActive: boolean },
    ctx: SessionContext = {},
  ) {
    if (!user.isActive) throw new UnauthorizedException('حساب کاربری غیرفعال است');
    return this.tokenFor(user.id, user.email, user.role, await this.sessions.create(user.id, ctx));
  }

  private tokenFor(userId: string, email: string, role: string, sid: string) {
    const accessToken = this.jwt.sign({ sub: userId, email, role, sid });
    return { accessToken, user: { id: userId, email, role } };
  }
}
