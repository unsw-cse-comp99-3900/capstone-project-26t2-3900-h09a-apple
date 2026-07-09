export type UserRole = 'EMPLOYEE' | 'REVIEWER' | 'MANAGER';

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
  tenant_id: string;
};

export type LoginRequest = {
  email: string;
  password: string;
};

export type LoginResponse = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
};

export type RegisterRequest = {
  email: string;
  password: string;
};

export type RegisterResponse = {
  user_id: string;
  role: UserRole;
};

export type RefreshResponse = {
  access_token: string;
  expires_in: number;
};

export type MeResponse = AuthUser;
