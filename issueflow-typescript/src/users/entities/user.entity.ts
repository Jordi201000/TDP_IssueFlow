import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Role } from '../../common/enums/role.enum';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 32 })
  username: string;

  @Column({ unique: true, length: 254 })
  email: string;

  @Column({ name: 'full_name', length: 120 })
  fullName: string;

  @Column({ type: 'varchar', length: 16 })
  role: Role;

  @Column({ name: 'password_hash' })
  @Exclude()
  passwordHash: string;

  @CreateDateColumn({ name: 'created_at' })
  @Exclude()
  createdAt: Date;
}
