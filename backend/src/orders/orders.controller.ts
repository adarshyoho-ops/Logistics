import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
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

@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @Roles('client')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createOrderDto: CreateOrderDto, @Req() req: RequestWithUser) {
    return this.ordersService.create(createOrderDto, req.user.userId);
  }

  @Get()
  @Roles('admin')
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('zone') zone?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.ordersService.findAll(
      pageNum,
      limitNum,
      status,
      priority,
      zone,
      startDate,
      endDate,
    );
  }

  @Get('my')
  @Roles('client', 'rider')
  async findMy(@Req() req: RequestWithUser) {
    const { userId, role } = req.user;
    if (role === 'client') {
      return this.ordersService.findMyOrders(userId);
    } else if (role === 'rider') {
      return this.ordersService.findRiderDeliveries(userId);
    }
    throw new BadRequestException('Unauthorized role access');
  }

  @Patch(':id/status')
  @Roles('rider')
  async updateStatus(
    @Param('id') id: string,
    @Body() updateDto: UpdateOrderStatusDto,
    @Req() req: RequestWithUser,
  ) {
    return this.ordersService.updateStatus(id, updateDto, req.user.userId);
  }
}
