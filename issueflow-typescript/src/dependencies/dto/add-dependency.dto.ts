import { IsInt, IsPositive } from 'class-validator';

export class AddDependencyDto {
  @IsInt()
  @IsPositive()
  blockedBy: number;
}
