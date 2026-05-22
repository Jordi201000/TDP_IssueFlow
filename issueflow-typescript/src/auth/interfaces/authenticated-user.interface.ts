import { Role } from '../../common/enums/role.enum';

export interface AuthenticatedUser {
  userId: number;
  username: string;
  role: Role;
}
