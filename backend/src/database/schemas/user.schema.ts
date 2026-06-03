import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true })
  name!: string;

  @Prop({ required: true, unique: true, index: true })
  email!: string;

  @Prop({ required: true })
  password!: string;

  @Prop({ required: true, enum: ['admin', 'client', 'rider'] })
  role!: 'admin' | 'client' | 'rider';

  // Rider-specific fields
  @Prop({ enum: ['available', 'offline'], default: 'offline' })
  status?: 'available' | 'offline';

  @Prop({ default: 0 })
  totalDelivered?: number;

  @Prop({ default: 0 })
  totalFailed?: number;

  @Prop({ default: 0 })
  avgDeliveryTime?: number;

  @Prop({ default: 0 })
  totalTimeTaken?: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Remove sensitive fields when converting to JSON
UserSchema.set('toJSON', {
  transform: (doc, ret) => {
    const userRet = ret as unknown as Record<string, unknown>;
    delete userRet.password;
    return userRet;
  },
});
