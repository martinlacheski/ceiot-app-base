import type { SessionUser } from '@/interfaces/user.interface';

// Login, Register, CheckStatus
export interface AuthResponse {
  user: SessionUser;
  token: string;
}
