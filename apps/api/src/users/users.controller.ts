import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
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

class UpdateUserByAdminDto {
  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  name?: string;
}

class SetPasswordByAdminDto {
  @IsString()
  @MinLength(6)
  password!: string;
}

class SetActiveByAdminDto {
  @IsBoolean()
  isActive!: boolean;
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

  @Patch(':id')
  @UseGuards(AdminGuard)
  updateUser(@Param('id') id: string, @Body() dto: UpdateUserByAdminDto) {
    return this.users.updateUserByAdmin(id, dto);
  }

  @Patch(':id/password')
  @UseGuards(AdminGuard)
  setPassword(@Param('id') id: string, @Body() dto: SetPasswordByAdminDto) {
    return this.users.setPasswordByAdmin(id, dto.password);
  }

  @Patch(':id/status')
  @UseGuards(AdminGuard)
  setStatus(@Param('id') id: string, @Body() dto: SetActiveByAdminDto) {
    return this.users.setActiveByAdmin(id, dto.isActive);
  }
}
