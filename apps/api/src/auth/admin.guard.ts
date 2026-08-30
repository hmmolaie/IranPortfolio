import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ user?: { role?: UserRole } }>();
    if (req.user?.role !== UserRole.ADMIN) {
      throw new ForbiddenException('فقط مدیر سیستم دسترسی دارد');
    }
    return true;
  }
}
