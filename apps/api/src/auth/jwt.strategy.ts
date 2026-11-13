import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { jwtSecret } from '../common/app-secrets';
import { SessionsService } from '../sessions/sessions.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret(),
    });
  }

  /** نقش و فعال بودن از دیتابیس خوانده می‌شود تا غیرفعال یا تنزل نقش همان لحظه اثر کند. */
  async validate(payload: { sub: string; email: string; role?: string; sid?: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, isActive: true },
    });
    if (!user || !user.isActive) throw new UnauthorizedException('جلسه نامعتبر است');
    // توکن‌های قبل از ثبت نشست sid ندارند و تا انقضا پذیرفته می‌شوند؛ تازه‌سازی بعدی نشست می‌سازد
    if (payload.sid && !(await this.sessions.touch(payload.sid, user.id))) {
      throw new UnauthorizedException('نشست شما بسته شده است؛ دوباره وارد شوید');
    }
    return { userId: user.id, email: user.email, role: user.role, sid: payload.sid };
  }
}
