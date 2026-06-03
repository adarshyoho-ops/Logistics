import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../database/schemas/user.schema';
import { Order, OrderDocument } from '../database/schemas/order.schema';
import { RedisService } from '../redis/redis.service';
import { SocketGateway } from '../socket/socket.gateway';
import { NotificationService } from '../notifications/notification.service';

interface ReassignedDetails {
  orderId: string;
  newRiderId: string | null;
  newRiderName: string | null;
  status: string;
}

@Injectable()
export class RidersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    private redisService: RedisService,
    private socketGateway: SocketGateway,
    private notificationService: NotificationService,
  ) {}

  async getRiders() {
    const riders = await this.userModel.find({ role: 'rider' }).exec();
    const result = [];

    for (const rider of riders) {
      const activeOrders = await this.orderModel.countDocuments({
        rider: rider._id,
        status: { $in: ['assigned', 'picked_up'] },
      });

      const locationStr = await this.redisService.get(`rider:location:${rider._id.toString()}`);
      const location = locationStr ? JSON.parse(locationStr) : null;

      result.push({
        id: rider._id.toString(),
        name: rider.name,
        email: rider.email,
        status: rider.status,
        activeOrders,
        totalDelivered: rider.totalDelivered || 0,
        totalFailed: rider.totalFailed || 0,
        avgDeliveryTime: rider.avgDeliveryTime || 0,
        location,
      });
    }

    return result;
  }

  async updateStatus(riderId: string, status: 'available' | 'offline'): Promise<User> {
    const rider = await this.userModel.findById(riderId);
    if (!rider) {
      throw new NotFoundException('Rider not found');
    }

    if (rider.role !== 'rider') {
      throw new BadRequestException('User is not a rider');
    }

    if (rider.status === status) {
      return rider;
    }

    // If going offline, auto-reassign all active orders
    if (status === 'offline') {
      const activeOrders = await this.orderModel
        .find({
          rider: rider._id,
          status: { $in: ['assigned', 'picked_up'] },
        })
        .populate('client')
        .exec();

      if (activeOrders.length > 0) {
        const reassignedDetailsList: ReassignedDetails[] = [];

        for (const order of activeOrders) {
          const clientName = (order.client as unknown as User).name;
          const clientId = order.client && '_id' in (order.client as any)
            ? (order.client as any)._id.toString()
            : order.client.toString();

          // Find another available rider (exclude going offline rider)
          const nextRider = await this.userModel.findOne({
            role: 'rider',
            status: 'available',
            _id: { $ne: rider._id },
          });

          if (nextRider) {
            order.status = 'assigned';
            order.rider = nextRider._id;
            order.timeline.push({
              status: 'assigned',
              timestamp: new Date(),
              details: `Auto-reassigned to rider ${nextRider.name} because previous rider went offline.`,
            });
            await order.save();

            reassignedDetailsList.push({
              orderId: order._id.toString(),
              newRiderId: nextRider._id.toString(),
              newRiderName: nextRider.name,
              status: 'assigned',
            });

            // Sockets
            this.socketGateway.emitToUser(clientId, 'order_assigned', {
              orderId: order._id.toString(),
              riderName: nextRider.name,
              estimatedTime: '15 mins',
            });
            this.socketGateway.emitToUser(nextRider._id.toString(), 'order_updated', order);

            // Notifications
            this.notificationService.notifyAdmin(
              `Order #${order._id.toString()} auto-reassigned to ${nextRider.name} — Rider ${rider.name} went offline.`,
            );
            this.notificationService.notifyRider(nextRider.name, order._id.toString(), 'assigned to you');
            this.notificationService.notifyClient(
              clientName,
              order._id.toString(),
              `reassigned to ${nextRider.name}`,
            );
          } else {
            // No other riders, mark as pending
            order.status = 'pending';
            order.rider = undefined;
            order.timeline.push({
              status: 'pending',
              timestamp: new Date(),
              details: 'Previous rider went offline. No available riders for reassignment.',
            });
            await order.save();

            reassignedDetailsList.push({
              orderId: order._id.toString(),
              newRiderId: null,
              newRiderName: null,
              status: 'pending',
            });

            // Sockets
            this.socketGateway.emitToUser(clientId, 'order_updated', order);

            // Notifications
            this.notificationService.notifyAdmin(
              `Order #${order._id.toString()} set to pending — Rider ${rider.name} went offline and no other available riders.`,
            );
            this.notificationService.notifyClient(
              clientName,
              order._id.toString(),
              'is now pending because the rider went offline',
            );
          }
        }

        // Emit rider_offline event with reassignment details
        this.socketGateway.emitToAdmins('rider_offline', {
          riderId: rider._id.toString(),
          reassignedOrders: reassignedDetailsList,
        });
      }
    }

    rider.status = status;
    await rider.save();

    // Emit rider_status_changed
    this.socketGateway.emitToAdmins('rider_status_changed', {
      riderId: rider._id.toString(),
      status: rider.status,
    });

    // Invalidate analytics cache
    await this.redisService.del('analytics:summary');

    return rider;
  }

  async updateLocation(riderId: string, lat: number, lng: number): Promise<{ success: boolean }> {
    const rider = await this.userModel.findById(riderId);
    if (!rider || rider.role !== 'rider') {
      throw new NotFoundException('Rider not found');
    }

    // Cache in Redis (expire in 1 day)
    const locationData = JSON.stringify({ lat, lng, updatedAt: new Date() });
    await this.redisService.set(`rider:location:${riderId}`, locationData, 86400);

    // Emit location_update to admin
    this.socketGateway.emitToAdmins('location_update', {
      riderId,
      lat,
      lng,
    });

    return { success: true };
  }
}
