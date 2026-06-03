import { IsNumber, IsNotEmpty } from 'class-validator';

export class UpdateRiderLocationDto {
  @IsNumber({}, { message: 'Latitude must be a number' })
  @IsNotEmpty({ message: 'Latitude is required' })
  lat!: number;

  @IsNumber({}, { message: 'Longitude must be a number' })
  @IsNotEmpty({ message: 'Longitude is required' })
  lng!: number;
}
