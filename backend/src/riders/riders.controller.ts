import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { RidersService } from './riders.service';
import { UpdateRiderStatusDto } from './dto/update-rider-status.dto';
import { UpdateRiderLocationDto } from './dto/update-rider-location.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

interface RequestWithUser {
  user: {
    userId: string;
    email: string;
    role: 'admin' | 'client' | 'rider';
    name: string;
  };
}

@Controller('riders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RidersController {
  constructor(private readonly ridersService: RidersService) {}

  @Get()
  @Roles('admin')
  async getRiders() {
    return this.ridersService.getRiders();
  }

  @Patch(':id/status')
  @Roles('admin', 'rider')
  async updateStatus(
    @Param('id') id: string,
    @Body() updateDto: UpdateRiderStatusDto,
    @Req() req: RequestWithUser,
  ) {
    const { userId, role } = req.user;

    // A rider can only update their own status
    if (role === 'rider' && userId !== id) {
      throw new ForbiddenException('Riders can only update their own status');
    }

    return this.ridersService.updateStatus(id, updateDto.status);
  }

  @Patch('location')
  @Roles('rider')
  @HttpCode(HttpStatus.OK)
  async updateLocation(@Body() locationDto: UpdateRiderLocationDto, @Req() req: RequestWithUser) {
    return this.ridersService.updateLocation(req.user.userId, locationDto.lat, locationDto.lng);
  }
}
