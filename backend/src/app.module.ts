import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { RedisModule } from './redis/redis.module';
import { NotificationModule } from './notifications/notification.module';
import { SocketModule } from './socket/socket.module';
import { AuthModule } from './auth/auth.module';
import { OrdersModule } from './orders/orders.module';
import { RidersModule } from './riders/riders.module';
import { AnalyticsModule } from './analytics/analytics.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI', 'mongodb://localhost:27017/logistics'),
      }),
      inject: [ConfigService],
    }),
    RedisModule,
    NotificationModule,
    SocketModule,
    AuthModule,
    OrdersModule,
    RidersModule,
    AnalyticsModule,
  ],
})
export class AppModule {}
