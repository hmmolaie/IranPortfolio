import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AdminBootstrapService } from './admin-bootstrap.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [UsersService, AdminBootstrapService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
