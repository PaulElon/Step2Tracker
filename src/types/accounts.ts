export interface AccountSummary {
  id: string;
  email: string;
  created_at: string;
  last_login_at: string | null;
  email_verified_at: string | null;
  legacy_data_adopted_at?: string | null;
}

export interface AccountCreateInput {
  email: string;
  password: string;
}

export interface AccountVerifyInput {
  email: string;
  password: string;
}
