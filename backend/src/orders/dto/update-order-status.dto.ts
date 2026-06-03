import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateOrderStatusDto {
  @IsEnum(['picked_up', 'delivered', 'failed'], {
    message: 'Status must be picked_up, delivered, or failed',
  })
  @IsNotEmpty({ message: 'Status is required' })
  status!: 'picked_up' | 'delivered' | 'failed';

  @IsString()
  @IsOptional()
  proofPhoto?: string;

  @IsString()
  @IsOptional()
  failedReason?: string;
}
