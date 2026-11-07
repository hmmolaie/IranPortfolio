import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { jwtSecret } from '../common/app-secrets';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret(),
    });
  }

  /** نقش و فعال بودن از دیتابیس خوانده می‌شود تا غیرفعال یا تنزل نقش همان لحظه اثر کند. */
  async validate(payload: { sub: string; email: string; role?: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, isActive: true },
    });
    if (!user || !user.isActive) throw new UnauthorizedException('جلسه نامعتبر است');
    return { userId: user.id, email: user.email, role: user.role };
  }
}
