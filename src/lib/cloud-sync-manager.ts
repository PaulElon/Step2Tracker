import type { AppState } from "../types/models";

const AUTH_URL = "https://timefolio-auth-v2.paulfreedman3.workers.dev";
const SYNC_URL = "https://timefolio-sync-v2.paulfreedman3.workers.dev";

export async function loginToCloud(
  email: string,
  password: string,
): Promise<{ cloudUserId: string; token: string; refreshToken: string }> {
  const res = await fetch(`${AUTH_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Login failed (${res.status})`);
  }
  return res.json() as Promise<{ cloudUserId: string; token: string; refreshToken: string }>;
}

export async function registerDevice(token: string, deviceId: string): Promise<void> {
  const res = await fetch(`${SYNC_URL}/sync/register-device`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ deviceId, deviceName: "Desktop", platform: "macos" }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `Register device failed (${res.status})`,
    );
  }
}

export async function pushAllEntities(
  token: string,
  deviceId: string,
  state: AppState,
): Promise<{ pushed: number }> {
  const entities = [
    ...state.studyBlocks.map((e) => ({
      entityType: "study_block",
      entityId: e.id,
      operation: "upsert" as const,
      payload: e as unknown as Record<string, unknown>,
      clientUpdatedAt: e.updatedAt,
    })),
    ...state.practiceTests.map((e) => ({
      entityType: "practice_test",
      entityId: e.id,
      operation: "upsert" as const,
      payload: e as unknown as Record<string, unknown>,
      clientUpdatedAt: e.updatedAt,
    })),
    ...state.weakTopicEntries.map((e) => ({
      entityType: "weak_topic_entry",
      entityId: e.id,
      operation: "upsert" as const,
      payload: e as unknown as Record<string, unknown>,
      clientUpdatedAt: e.updatedAt,
    })),
  ];
  const res = await fetch(`${SYNC_URL}/sync/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ deviceId, entities }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Sync push failed (${res.status})`);
  }
  return { pushed: entities.length };
}
