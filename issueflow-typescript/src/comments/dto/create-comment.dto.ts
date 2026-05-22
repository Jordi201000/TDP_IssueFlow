import {
  IsInt,
  IsNotEmpty,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateCommentDto {
  @IsInt()
  @IsPositive()
  authorId: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content: string;
}
