import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RidersService } from './riders.service';
import { RidersController } from './riders.controller';
import { User, UserSchema } from '../database/schemas/user.schema';
import { Order, OrderSchema } from '../database/schemas/order.schema';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Order.name, schema: OrderSchema },
    ]),
    AuthModule,
  ],
  providers: [RidersService],
  controllers: [RidersController],
  exports: [RidersService],
})
export class RidersModule {}
