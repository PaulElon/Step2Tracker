import { core } from "@tauri-apps/api";
import type {
  AccountCreateInput,
  AccountSummary,
  AccountVerifyInput,
} from "../types/accounts";

function command<T>(name: string, args?: Record<string, unknown>) {
  return core.invoke<T>(name, args);
}

export function accountCount(): Promise<number> {
  return command<number>("account_count");
}

export function listAccountEmails(): Promise<string[]> {
  return command<string[]>("account_list_emails");
}

export function createAccount(input: AccountCreateInput): Promise<AccountSummary> {
  return command<AccountSummary>("account_create", {
    email: input.email,
    password: input.password,
  });
}

export function verifyAccount(input: AccountVerifyInput): Promise<AccountSummary> {
  return command<AccountSummary>("account_verify", {
    email: input.email,
    password: input.password,
  });
}
