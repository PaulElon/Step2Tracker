import { core } from "@tauri-apps/api";
import type {
  AccountChangePasswordInput,
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

export function rememberSession(accountId: string): Promise<void> {
  return command<void>("account_remember_session", { accountId });
}

export function loadRememberedSession(): Promise<AccountSummary | null> {
  return command<AccountSummary | null>("account_load_remembered_session");
}

export function clearRememberedSession(): Promise<void> {
  return command<void>("account_clear_remembered_session");
}

export function changePassword(input: AccountChangePasswordInput): Promise<void> {
  return command<void>("account_change_password", {
    accountId: input.accountId,
    currentPassword: input.currentPassword,
    newPassword: input.newPassword,
  });
}
