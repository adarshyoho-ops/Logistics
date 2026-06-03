import { IsEnum, IsNotEmpty, IsString } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty({ message: 'Pickup address is required' })
  pickupAddress!: string;

  @IsString()
  @IsNotEmpty({ message: 'Drop address is required' })
  dropAddress!: string;

  @IsString()
  @IsNotEmpty({ message: 'Package details are required' })
  packageDetails!: string;

  @IsEnum(['normal', 'urgent'], { message: 'Priority must be normal or urgent' })
  @IsNotEmpty({ message: 'Priority is required' })
  priority!: 'normal' | 'urgent';
}
