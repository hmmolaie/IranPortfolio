import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
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

  @IsOptional()
  @IsString()
  mobilePhone?: string;

  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH'])
  liquidityNeed?: 'LOW' | 'MEDIUM' | 'HIGH' | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(80)
  maxDrawdownPct?: number | null;

  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH'])
  inflationSensitivity?: 'LOW' | 'MEDIUM' | 'HIGH' | null;

  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH'])
  fxSensitivity?: 'LOW' | 'MEDIUM' | 'HIGH' | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  objectiveFa?: string | null;
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

class OptionsAccessDto {
  @IsBoolean()
  enabled!: boolean;
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

class ChangeOwnPasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(6)
  newPassword!: string;
}

class SetRoleDto {
  @IsIn(['ADMIN', 'USER', 'RESELLER'])
  role!: 'ADMIN' | 'USER' | 'RESELLER';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(90)
  discountPct?: number;
}

class UpdateReferralDto {
  @IsOptional()
  @IsString()
  @MaxLength(16)
  referralCode?: string;

  @IsOptional()
  @IsBoolean()
  referralActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(90)
  discountPct?: number;
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

  @Get('reseller/report')
  referralReport(
    @Req() req: { user: { userId: string; role?: string } },
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const role = req.user.role ?? '';
    if (role !== 'ADMIN' && role !== 'RESELLER') {
      throw new ForbiddenException('دسترسی به این گزارش ندارید');
    }
    return this.users.referralReport(req.user.userId, role, from, to);
  }

  @Get('mine')
  mine(@Req() req: { user: { userId: string; role?: string } }) {
    this.assertReseller(req.user.role);
    return this.users.listForReseller(req.user.userId);
  }

  @Post('mine')
  createMine(@Req() req: { user: { userId: string; role?: string } }, @Body() dto: CreateUserDto) {
    this.assertReseller(req.user.role);
    return this.users.createForReseller(req.user.userId, dto);
  }

  @Patch('mine/:id/options-access')
  setMineOptionsAccess(
    @Req() req: { user: { userId: string; role?: string } },
    @Param('id') id: string,
    @Body() dto: OptionsAccessDto,
  ) {
    this.assertReseller(req.user.role);
    return this.users.setOptionsAccessByReseller(req.user.userId, id, dto.enabled);
  }

  @Patch('mine/:id/password')
  setMinePassword(
    @Req() req: { user: { userId: string; role?: string } },
    @Param('id') id: string,
    @Body() dto: SetPasswordByAdminDto,
  ) {
    this.assertReseller(req.user.role);
    return this.users.setPasswordByReseller(req.user.userId, id, dto.password);
  }

  private assertReseller(role?: string) {
    if (role !== 'RESELLER') throw new ForbiddenException('فقط Reseller می‌تواند کاربر تعریف کند');
  }

  @Patch('me')
  updateMe(@Req() req: { user: { userId: string } }, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(req.user.userId, dto);
  }

  @Patch('me/password')
  changeOwnPassword(
    @Req() req: { user: { userId: string } },
    @Body() dto: ChangeOwnPasswordDto,
  ) {
    return this.users.changeOwnPassword(
      req.user.userId,
      dto.currentPassword,
      dto.newPassword,
    );
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

  @Patch(':id/options-access')
  @UseGuards(AdminGuard)
  setOptionsAccess(@Param('id') id: string, @Body() dto: OptionsAccessDto) {
    return this.users.setOptionsAccessByAdmin(id, dto.enabled);
  }

  @Patch(':id/status')
  @UseGuards(AdminGuard)
  setStatus(@Param('id') id: string, @Body() dto: SetActiveByAdminDto) {
    return this.users.setActiveByAdmin(id, dto.isActive);
  }

  @Patch(':id/role')
  @UseGuards(AdminGuard)
  setRole(@Req() req: { user: { userId: string } }, @Param('id') id: string, @Body() dto: SetRoleDto) {
    return this.users.setRoleByAdmin(req.user.userId, id, dto.role, dto.discountPct);
  }

  @Patch(':id/referral')
  @UseGuards(AdminGuard)
  updateReferral(@Param('id') id: string, @Body() dto: UpdateReferralDto) {
    return this.users.updateReferralByAdmin(id, dto);
  }
}
