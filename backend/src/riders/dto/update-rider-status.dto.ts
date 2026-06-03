import { IsEnum, IsNotEmpty } from 'class-validator';

export class UpdateRiderStatusDto {
  @IsEnum(['available', 'offline'], { message: 'Status must be available or offline' })
  @IsNotEmpty({ message: 'Status is required' })
  status!: 'available' | 'offline';
}
