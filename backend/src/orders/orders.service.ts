import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { Order, OrderDocument } from '../database/schemas/order.schema';
import { User, UserDocument } from '../database/schemas/user.schema';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { RedisService } from '../redis/redis.service';
import { SocketGateway } from '../socket/socket.gateway';
import { NotificationService } from '../notifications/notification.service';

@Injectable()
export class OrdersService {
  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private redisService: RedisService,
    private socketGateway: SocketGateway,
    private notificationService: NotificationService,
  ) {}

  private extractZone(address: string): string {
    const lower = address.toLowerCase();
    if (lower.includes('north')) return 'North';
    if (lower.includes('south')) return 'South';
    if (lower.includes('east')) return 'East';
    if (lower.includes('west')) return 'West';
    const zones = ['North', 'South', 'East', 'West', 'Central'];
    // Deterministic selection based on string length to avoid random test behaviors
    const index = address.length % zones.length;
    return zones[index];
  }

  async create(createOrderDto: CreateOrderDto, clientId: string): Promise<Order> {
    const { pickupAddress, dropAddress, packageDetails, priority } = createOrderDto;

    // Get client details
    const client = await this.userModel.findById(clientId);
    if (!client) {
      throw new NotFoundException('Client not found');
    }

    // Smart assignment rules: Find available riders
    const availableRiders = await this.userModel.find({
      role: 'rider',
      status: 'available',
    });

    if (availableRiders.length === 0) {
      throw new HttpException(
        { retryAfter: 60, message: 'No available riders at the moment.' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    let selectedRider: UserDocument;

    if (priority === 'urgent') {
      // Urgent: assign rider with least active orders
      let minActiveOrders = Infinity;
      let chosenRider = availableRiders[0];

      for (const rider of availableRiders) {
        const activeCount = await this.orderModel.countDocuments({
          rider: rider._id,
          status: { $in: ['assigned', 'picked_up'] },
        });
        if (activeCount < minActiveOrders) {
          minActiveOrders = activeCount;
          chosenRider = rider;
        }
      }
      selectedRider = chosenRider;
    } else {
      // Normal: assign any available rider (first one)
      selectedRider = availableRiders[0];
    }

    const zone = this.extractZone(pickupAddress);

    // Create order with assigned status
    const order = new this.orderModel({
      pickupAddress,
      dropAddress,
      packageDetails,
      priority,
      status: 'assigned',
      client: new Types.ObjectId(clientId),
      rider: selectedRider._id,
      zone,
      timeline: [
        { status: 'pending', timestamp: new Date(), details: 'Order created.' },
        {
          status: 'assigned',
          timestamp: new Date(),
          details: `Assigned to rider ${selectedRider.name}.`,
        },
      ],
    });

    await order.save();

    // Emit Socket.io event: order_assigned
    this.socketGateway.emitToUser(clientId, 'order_assigned', {
      orderId: order._id.toString(),
      riderName: selectedRider.name,
      estimatedTime: '15 mins',
    });

    // Notify admins about the new order
    this.socketGateway.emitToAdmins('order_updated', order);
    this.socketGateway.emitToUser(selectedRider._id.toString(), 'order_updated', order);

    // Invalidate analytics cache
    await this.redisService.del('analytics:summary');

    // Trigger Notification logs
    this.notificationService.notifyClient(client.name, order._id.toString(), `is assigned to ${selectedRider.name}`);
    this.notificationService.notifyRider(selectedRider.name, order._id.toString(), 'assigned to you');

    return order;
  }

  async findAll(
    page = 1,
    limit = 10,
    status?: string,
    priority?: string,
    zone?: string,
    startDate?: string,
    endDate?: string,
  ): Promise<{ orders: Order[]; total: number; page: number; limit: number }> {
    const filter: Record<string, any> = {};

    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (zone) filter.zone = zone;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const skip = (page - 1) * limit;
    const orders = await this.orderModel
      .find(filter)
      .populate('client')
      .populate('rider')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .exec();

    const total = await this.orderModel.countDocuments(filter);

    return { orders, total, page, limit };
  }

  async findMyOrders(clientId: string): Promise<Order[]> {
    return this.orderModel
      .find({ client: new Types.ObjectId(clientId) })
      .populate('rider')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findRiderDeliveries(riderId: string): Promise<Order[]> {
    return this.orderModel
      .find({ rider: new Types.ObjectId(riderId) })
      .populate('client')
      .sort({ createdAt: -1 })
      .exec();
  }

  async updateStatus(
    orderId: string,
    updateDto: UpdateOrderStatusDto,
    riderId: string,
  ): Promise<Order> {
    const { status, proofPhoto, failedReason } = updateDto;

    const order = await this.orderModel.findById(orderId).populate('client').populate('rider');
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const assignedRiderId = order.rider && '_id' in (order.rider as any)
      ? (order.rider as any)._id.toString()
      : order.rider?.toString();

    if (assignedRiderId !== riderId) {
      throw new BadRequestException('You are not the assigned rider for this order');
    }

    // Strict status flow validation
    // pending -> assigned -> picked_up -> delivered/failed
    const currentStatus = order.status;
    if (status === 'picked_up') {
      if (currentStatus !== 'assigned') {
        throw new BadRequestException('Order status must be assigned before picking up');
      }
    } else if (status === 'delivered' || status === 'failed') {
      if (currentStatus !== 'picked_up') {
        throw new BadRequestException('Order status must be picked_up before final delivery status');
      }
    } else {
      throw new BadRequestException('Invalid target status');
    }

    order.status = status;
    order.timeline.push({
      status,
      timestamp: new Date(),
      details: status === 'failed' ? failedReason : `Status updated to ${status}`,
    });

    const clientName = (order.client as unknown as User).name;
    const riderName = (order.rider as unknown as User).name;

    const clientId = order.client && '_id' in (order.client as any)
      ? (order.client as any)._id.toString()
      : order.client.toString();

    if (status === 'delivered') {
      order.proofPhoto = proofPhoto;
      // Calculate time taken in minutes
      const createdTime = order.createdAt ? new Date(order.createdAt).getTime() : Date.now();
      const timeDiffMs = Date.now() - createdTime;
      const timeTakenMinutes = Math.max(1, Math.round(timeDiffMs / 60000));
      order.timeTaken = timeTakenMinutes;

      await order.save();

      // Update rider statistics
      const rider = await this.userModel.findById(riderId);
      if (rider) {
        rider.totalDelivered = (rider.totalDelivered || 0) + 1;
        rider.totalTimeTaken = (rider.totalTimeTaken || 0) + timeTakenMinutes;
        rider.avgDeliveryTime = Math.round(rider.totalTimeTaken / rider.totalDelivered);
        await rider.save();
      }

      // Emit client and admin socket updates
      this.socketGateway.emitToUser(clientId, 'order_delivered', {
        orderId: order._id.toString(),
      });
      this.socketGateway.emitToAdmins('order_updated', order);
      this.socketGateway.emitToUser(riderId, 'order_updated', order);

      // Invalidate analytics cache
      await this.redisService.del('analytics:summary');

      // Console notifications
      this.notificationService.notifyClient(clientName, order._id.toString(), 'is delivered! 🎉');

    } else if (status === 'failed') {
      order.failedReason = failedReason;
      await order.save();

      // Update rider statistics
      const rider = await this.userModel.findById(riderId);
      if (rider) {
        rider.totalFailed = (rider.totalFailed || 0) + 1;
        await rider.save();
      }

      this.notificationService.notifyAdmin(`Order #${order._id.toString()} failed - reason: ${failedReason}`);

      // Auto-reassign to next available rider
      const nextRider = await this.userModel.findOne({
        role: 'rider',
        status: 'available',
        _id: { $ne: new Types.ObjectId(riderId) }, // Exclude current rider
      });

      if (nextRider) {
        order.status = 'assigned';
        order.rider = nextRider._id;
        order.timeline.push({
          status: 'assigned',
          timestamp: new Date(),
          details: `Auto-reassigned to rider ${nextRider.name} after failure.`,
        });
        await order.save();

        // Emit assignments
        this.socketGateway.emitToUser(clientId, 'order_assigned', {
          orderId: order._id.toString(),
          riderName: nextRider.name,
          estimatedTime: '15 mins',
        });
        this.socketGateway.emitToUser(nextRider._id.toString(), 'order_updated', order);

        // Notifications
        this.notificationService.notifyAdmin(`Order #${order._id.toString()} failed — auto reassigned to ${nextRider.name}`);
        this.notificationService.notifyRider(nextRider.name, order._id.toString(), 'assigned to you');
        this.notificationService.notifyClient(clientName, order._id.toString(), `has been reassigned to ${nextRider.name}`);
      } else {
        // No available riders, mark back as pending
        order.status = 'pending';
        order.rider = undefined;
        order.timeline.push({
          status: 'pending',
          timestamp: new Date(),
          details: 'Order failed and no riders are available for reassignment.',
        });
        await order.save();

        this.notificationService.notifyAdmin(`Order #${order._id.toString()} failed — no riders available for auto-reassignment`);
      }

      this.socketGateway.emitToAdmins('order_updated', order);
      this.socketGateway.emitToUser(clientId, 'order_updated', order);

      // Invalidate analytics cache
      await this.redisService.del('analytics:summary');
    } else {
      // picked_up
      await order.save();
      this.socketGateway.emitToAdmins('order_updated', order);
      this.socketGateway.emitToUser(clientId, 'order_updated', order);
      this.socketGateway.emitToUser(riderId, 'order_updated', order);

      this.notificationService.notifyClient(clientName, order._id.toString(), 'is picked up');
    }

    return order;
  }
}
