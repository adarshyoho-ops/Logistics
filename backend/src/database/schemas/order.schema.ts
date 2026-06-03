import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type OrderDocument = Order & Document;

export interface TimelineEntry {
  status: string;
  timestamp: Date;
  details?: string;
}

@Schema({ timestamps: true })
export class Order {
  @Prop({ required: true })
  pickupAddress!: string;

  @Prop({ required: true })
  dropAddress!: string;

  @Prop({ required: true })
  packageDetails!: string;

  @Prop({ required: true, enum: ['normal', 'urgent'] })
  priority!: 'normal' | 'urgent';

  @Prop({
    required: true,
    enum: ['pending', 'assigned', 'picked_up', 'delivered', 'failed'],
    default: 'pending',
  })
  status!: 'pending' | 'assigned' | 'picked_up' | 'delivered' | 'failed';

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  client!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  rider?: Types.ObjectId;

  @Prop()
  proofPhoto?: string;

  @Prop()
  failedReason?: string;

  @Prop()
  timeTaken?: number; // In minutes

  @Prop({ required: true, default: 'Central' })
  zone!: string; // e.g., 'North' | 'South' | 'East' | 'West' | 'Central'

  @Prop({
    type: [
      {
        status: { type: String, required: true },
        timestamp: { type: Date, required: true, default: Date.now },
        details: { type: String },
      },
    ],
    default: [],
  })
  timeline!: TimelineEntry[];

  createdAt?: Date;
  updatedAt?: Date;
}

export const OrderSchema = SchemaFactory.createForClass(Order);
OrderSchema.index({ status: 1 });
OrderSchema.index({ client: 1 });
OrderSchema.index({ rider: 1 });
OrderSchema.index({ zone: 1 });
OrderSchema.index({ createdAt: 1 });
