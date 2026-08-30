import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { UserRole } from '@prisma/client';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  riskTolerance?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  horizonMonths?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  investmentPreferencesFa?: string;

  @IsOptional()
  @IsString()
  constraintsFa?: string;
}

class CreateUserDto {
  @IsString()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsOptional()
  @IsString()
  name?: string;
}

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  async me(@Req() req: { user: { userId: string } }) {
    const user = await this.users.findById(req.user.userId);
    if (!user) return null;
    const { passwordHash, llmSetting, ...rest } = user;
    return {
      ...rest,
      llmConfigured: Boolean(llmSetting?.apiTokenEncrypted),
    };
  }

  @Get()
  @UseGuards(AdminGuard)
  listUsers() {
    return this.users.listForAdmin();
  }

  @Post()
  @UseGuards(AdminGuard)
  createUser(@Body() dto: CreateUserDto) {
    return this.users.createUser(dto);
  }

  @Patch('me')
  updateMe(@Req() req: { user: { userId: string } }, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(req.user.userId, dto);
  }
}
