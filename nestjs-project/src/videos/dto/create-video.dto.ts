import { IsInt, IsNotEmpty, IsPositive, IsString } from 'class-validator';

export class CreateVideoDto {
  @IsString()
  @IsNotEmpty()
  original_filename: string;

  @IsString()
  @IsNotEmpty()
  mime_type: string;

  @IsInt()
  @IsPositive()
  size_bytes: number;
}
