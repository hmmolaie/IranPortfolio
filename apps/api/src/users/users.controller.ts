import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

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

  @Patch('me')
  updateMe(@Req() req: { user: { userId: string } }, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(req.user.userId, dto);
  }
}
