import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, OrderDocument } from '../database/schemas/order.schema';
import { User, UserDocument } from '../database/schemas/user.schema';
import { RedisService } from '../redis/redis.service';

export interface RiderPerf {
  riderName: string;
  delivered: number;
  failed: number;
  avgTime: number;
  rating: number;
}

export interface ZoneSummary {
  zone: string;
  totalOrders: number;
  successRate: number;
}

export interface AnalyticsSummary {
  totalOrders: number;
  delivered: number;
  failed: number;
  pending: number;
  avgDeliveryTime: number;
  successRate: number;
  peakHour: string;
  riderPerformance: RiderPerf[];
  zoneWiseSummary: ZoneSummary[];
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private redisService: RedisService,
  ) {}

  async getSummary(): Promise<AnalyticsSummary> {
    const cacheKey = 'analytics:summary';
    
    // Check Redis cache first
    try {
      const cached = await this.redisService.get(cacheKey);
      if (cached) {
        this.logger.log('Returning cached analytics summary');
        return JSON.parse(cached) as AnalyticsSummary;
      }
    } catch (err) {
      this.logger.error('Failed to read analytics from Redis cache:', err);
    }

    this.logger.log('Compiling fresh analytics summary');

    // 1. Total, Delivered, Failed, Pending counts
    const totalOrders = await this.orderModel.countDocuments();
    const delivered = await this.orderModel.countDocuments({ status: 'delivered' });
    const failed = await this.orderModel.countDocuments({ status: 'failed' });
    const pending = await this.orderModel.countDocuments({ status: 'pending' });

    // 2. Average delivery time
    const deliveredOrders = await this.orderModel.find({
      status: 'delivered',
      timeTaken: { $exists: true },
    });
    const totalDelivered = deliveredOrders.length;
    const totalTime = deliveredOrders.reduce((acc, o) => acc + (o.timeTaken || 0), 0);
    const avgDeliveryTime = totalDelivered > 0 ? parseFloat((totalTime / totalDelivered).toFixed(1)) : 0;

    // 3. Success Rate
    const successRate =
      delivered + failed > 0
        ? parseFloat(((delivered / (delivered + failed)) * 100).toFixed(1))
        : 0;

    // 4. Peak Hour
    const allOrders = await this.orderModel.find({}, 'createdAt').exec();
    const hoursCount = new Array(24).fill(0);
    allOrders.forEach((o) => {
      if (o.createdAt) {
        const hour = new Date(o.createdAt).getHours();
        hoursCount[hour]++;
      }
    });

    let peakHourIdx = 0;
    let maxCount = 0;
    for (let i = 0; i < 24; i++) {
      if (hoursCount[i] > maxCount) {
        maxCount = hoursCount[i];
        peakHourIdx = i;
      }
    }
    const peakHour = `${String(peakHourIdx).padStart(2, '0')}:00 - ${String(
      (peakHourIdx + 1) % 24,
    ).padStart(2, '0')}:00`;

    // 5. Rider Performance
    const riders = await this.userModel.find({ role: 'rider' }).exec();
    const riderPerformance: RiderPerf[] = riders.map((r) => {
      const totalRiderOrders = (r.totalDelivered || 0) + (r.totalFailed || 0);
      const riderSuccessRate = totalRiderOrders > 0 ? (r.totalDelivered || 0) / totalRiderOrders : 1;
      const rating = parseFloat((3.5 + riderSuccessRate * 1.5).toFixed(1)); // Map success to 3.5 - 5.0 rating

      return {
        riderName: r.name,
        delivered: r.totalDelivered || 0,
        failed: r.totalFailed || 0,
        avgTime: r.avgDeliveryTime || 0,
        rating,
      };
    });

    // 6. Zone-wise summary
    const zoneOrders = await this.orderModel.find({}, 'zone status').exec();
    const zonesMap = new Map<string, { total: number; delivered: number; failed: number }>();
    zoneOrders.forEach((o) => {
      const zone = o.zone || 'Central';
      if (!zonesMap.has(zone)) {
        zonesMap.set(zone, { total: 0, delivered: 0, failed: 0 });
      }
      const stats = zonesMap.get(zone)!;
      stats.total++;
      if (o.status === 'delivered') stats.delivered++;
      if (o.status === 'failed') stats.failed++;
    });

    const zoneWiseSummary: ZoneSummary[] = Array.from(zonesMap.entries()).map(([zone, stats]) => {
      const finished = stats.delivered + stats.failed;
      const zoneSuccess = finished > 0 ? parseFloat(((stats.delivered / finished) * 100).toFixed(1)) : 100;
      return {
        zone,
        totalOrders: stats.total,
        successRate: zoneSuccess,
      };
    });

    const summary: AnalyticsSummary = {
      totalOrders,
      delivered,
      failed,
      pending,
      avgDeliveryTime,
      successRate,
      peakHour,
      riderPerformance,
      zoneWiseSummary,
    };

    // Cache in Redis for 60 seconds
    try {
      await this.redisService.set(cacheKey, JSON.stringify(summary), 60);
    } catch (err) {
      this.logger.error('Failed to cache analytics summary in Redis:', err);
    }

    return summary;
  }
}
