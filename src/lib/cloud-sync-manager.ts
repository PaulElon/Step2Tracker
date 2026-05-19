import type {
  AppState,
  ErrorLogEntry,
  PersistenceSnapshot,
  PracticeTest,
  StudyBlock,
  TfAppState,
  TfSessionLogTombstone,
  WeakTopicEntry,
} from "../types/models";
// @ts-expect-error TS5097: node --test needs the explicit .ts specifier in this runtime path.
import { buildCanonicalSessionLogExport } from "./tf-session-log-canonical-export.ts";
import type { CloudDeleteTombstone, CloudEntityType } from "./native-persistence";

const AUTH_URL = "https://timefolio-auth-v2.paulfreedman3.workers.dev";
const SYNC_URL = "https://timefolio-sync-v2.paulfreedman3.workers.dev";

type CloudPullOperation = "upsert" | "delete";

interface CloudPullEntry {
  entityType: string;
  entityId: string;
  operation: CloudPullOperation;
  payload: unknown;
  clientUpdatedAt: string;
}

interface CloudPullResponse {
  entries: CloudPullEntry[];
  cursor: number;
}

export interface CloudPullResult {
  received: number;
  applied: number;
  upserted: number;
  deleted: number;
  skipped: number;
  cursor: number;
}

interface CloudPullDependencies {
  fetchImpl?: typeof fetch;
  getCursor?: () => Promise<number | null>;
  setCursor?: (value: number) => Promise<void>;
  loadSnapshot?: () => Promise<PersistenceSnapshot>;
  getDeleteTombstones?: (after?: string | null) => Promise<CloudDeleteTombstone[]>;
  applyStudyBlock?: (block: StudyBlock) => Promise<void>;
  applyPracticeTest?: (test: PracticeTest) => Promise<void>;
  applyWeakTopic?: (entry: WeakTopicEntry) => Promise<void>;
  applyErrorLog?: (entry: ErrorLogEntry) => Promise<void>;
  applyDelete?: (
    entityType: CloudEntityType,
    entityId: string,
    deletedAt: string,
  ) => Promise<void>;
}

interface CloudPushDependencies {
  loadTfState?: () => Promise<TfAppState>;
}

async function loadDefaultPullDependencies() {
  const native = await import(new URL("./native-persistence.ts", import.meta.url).href);
  return {
    getCursor: native.getCloudPullCursor,
    setCursor: native.setCloudPullCursor,
    loadSnapshot: native.loadNativeSnapshot,
    getDeleteTombstones: async (after?: string | null) => {
      const [coreTombstones, errorLogTombstones] = await Promise.all([
        native.getCoreEntityDeleteTombstones(after),
        native.getErrorLogDeleteTombstones(after),
      ]);
      return [...coreTombstones, ...errorLogTombstones];
    },
    applyStudyBlock: native.applyCloudStudyBlock,
    applyPracticeTest: native.applyCloudPracticeTest,
    applyWeakTopic: native.applyCloudWeakTopic,
    applyErrorLog: native.applyCloudErrorLogEntry,
    applyDelete: native.applyCloudDelete,
  };
}

async function loadDefaultPushDependencies(): Promise<Required<CloudPushDependencies>> {
  const native = await import(new URL("./native-persistence.ts", import.meta.url).href);
  return {
    loadTfState: native.loadNativeTfState,
  };
}

function parseJsonBody<T>(res: Response, fallbackMessage: string) {
  return res.json().catch(async () => {
    const text = await res.text().catch(() => "");
    throw new Error(text || fallbackMessage);
  }) as Promise<T>;
}

function compareTimestamps(left: string, right: string) {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (Number.isNaN(leftMs) || Number.isNaN(rightMs)) {
    throw new Error("Cloud sync received an invalid timestamp.");
  }
  return leftMs - rightMs;
}

function indexLocalEntities(state: AppState) {
  return {
    study_block: new Map(state.studyBlocks.map((block) => [block.id, block])),
    practice_test: new Map(state.practiceTests.map((test) => [test.id, test])),
    weak_topic_entry: new Map(state.weakTopicEntries.map((entry) => [entry.id, entry])),
    error_log_entry: new Map(state.errorLogEntries.map((entry) => [entry.id, entry])),
  };
}

function indexDeleteTombstones(tombstones: CloudDeleteTombstone[]) {
  return {
    study_block: new Map(
      tombstones
        .filter((entry) => entry.entityType === "study_block")
        .map((entry) => [entry.entityId, entry.deletedAt]),
    ),
    practice_test: new Map(
      tombstones
        .filter((entry) => entry.entityType === "practice_test")
        .map((entry) => [entry.entityId, entry.deletedAt]),
    ),
    weak_topic_entry: new Map(
      tombstones
        .filter((entry) => entry.entityType === "weak_topic_entry")
        .map((entry) => [entry.entityId, entry.deletedAt]),
    ),
    error_log_entry: new Map(
      tombstones
        .filter((entry) => entry.entityType === "error_log_entry")
        .map((entry) => [entry.entityId, entry.deletedAt]),
    ),
  };
}

function isObjectPayload(payload: unknown): payload is Record<string, unknown> {
  return payload !== null && typeof payload === "object" && !Array.isArray(payload);
}

function coerceCloudPullPayload(payload: unknown): Record<string, unknown> | null {
  if (isObjectPayload(payload)) {
    return payload;
  }
  if (typeof payload !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(payload) as unknown;
    return isObjectPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isSupportedCloudPullEntityType(entityType: string): entityType is CloudEntityType {
  return (
    entityType === "study_block" ||
    entityType === "practice_test" ||
    entityType === "weak_topic_entry" ||
    entityType === "error_log_entry"
  );
}

function formatPullUrl(deviceId: string, since: number) {
  const url = new URL(`${SYNC_URL}/sync/pull`);
  url.searchParams.set("since", String(since));
  url.searchParams.set("deviceId", deviceId);
  return url.toString();
}

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

export async function refreshCloudToken(
  refreshToken: string,
): Promise<{ token: string; refreshToken: string }> {
  const res = await fetch(`${AUTH_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Refresh failed (${res.status})`);
  }
  return res.json() as Promise<{ token: string; refreshToken: string }>;
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
  lastSyncedAt: string | null,
  deleteTombstones: CloudDeleteTombstone[],
  dependencies: CloudPushDependencies = {},
): Promise<{ pushed: number; cursor: number | null }> {
  const after = lastSyncedAt;
  const { loadTfState } = dependencies.loadTfState
    ? { loadTfState: dependencies.loadTfState }
    : await loadDefaultPushDependencies();
  const tfState = await loadTfState();
  const canonicalSessionLogs = buildCanonicalSessionLogExport(tfState.sessionLogs);
  const sessionLogDeleteTombstones = tfState.sessionLogTombstones.filter(
    (entry): entry is TfSessionLogTombstone =>
      entry.syncEligible === true &&
      (entry.syncSource === "manual" || entry.syncSource === "imported") &&
      (!after || entry.deletedAt >= after),
  );
  const entities = [
    ...state.studyBlocks
      .filter((entry) => !after || entry.updatedAt >= after)
      .map((entry) => ({
        entityType: "study_block",
        entityId: entry.id,
        operation: "upsert" as const,
        payload: entry as unknown as Record<string, unknown>,
        clientUpdatedAt: entry.updatedAt,
      })),
    ...state.practiceTests
      .filter((entry) => !after || entry.updatedAt >= after)
      .map((entry) => ({
        entityType: "practice_test",
        entityId: entry.id,
        operation: "upsert" as const,
        payload: entry as unknown as Record<string, unknown>,
        clientUpdatedAt: entry.updatedAt,
      })),
    ...state.weakTopicEntries
      .filter((entry) => !after || entry.updatedAt >= after)
      .map((entry) => ({
        entityType: "weak_topic_entry",
        entityId: entry.id,
        operation: "upsert" as const,
        payload: entry as unknown as Record<string, unknown>,
        clientUpdatedAt: entry.updatedAt,
      })),
    ...state.errorLogEntries
      .filter((entry) => !after || entry.updatedAt >= after)
      .map((entry) => ({
        entityType: "error_log_entry",
        entityId: entry.id,
        operation: "upsert" as const,
        payload: entry as unknown as Record<string, unknown>,
        clientUpdatedAt: entry.updatedAt,
      })),
    ...canonicalSessionLogs
      .filter((entry) => !after || entry.updatedAt >= after)
      .map((entry) => ({
        entityType: "session_log",
        entityId: entry.id,
        operation: "upsert" as const,
        payload: entry as unknown as Record<string, unknown>,
        clientUpdatedAt: entry.updatedAt,
      })),
    ...sessionLogDeleteTombstones.map((entry) => ({
      entityType: "session_log",
      entityId: entry.id,
      operation: "delete" as const,
      payload: null,
      clientUpdatedAt: entry.deletedAt,
    })),
    ...deleteTombstones
      .filter((entry) => !after || entry.deletedAt >= after)
      .map((entry) => ({
        entityType: entry.entityType,
        entityId: entry.entityId,
        operation: "delete" as const,
        payload: null,
        clientUpdatedAt: entry.deletedAt,
      })),
  ];
  if (entities.length === 0) {
    return { pushed: 0, cursor: null };
  }
  const res = await fetch(`${SYNC_URL}/sync/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ deviceId, entities }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Sync push failed (${res.status})`);
  }
  const data = (await res.json()) as { cursor: number };
  return { pushed: entities.length, cursor: data.cursor };
}

export async function pullFromCloud(
  token: string,
  deviceId: string,
  dependencies: CloudPullDependencies = {},
): Promise<CloudPullResult> {
  const needsDefaults =
    !dependencies.getCursor ||
    !dependencies.setCursor ||
    !dependencies.loadSnapshot ||
    !dependencies.getDeleteTombstones ||
    !dependencies.applyStudyBlock ||
    !dependencies.applyPracticeTest ||
    !dependencies.applyWeakTopic ||
    !dependencies.applyErrorLog ||
    !dependencies.applyDelete;
  const defaults = needsDefaults ? await loadDefaultPullDependencies() : null;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const getCursor = dependencies.getCursor ?? defaults?.getCursor;
  const saveCursor = dependencies.setCursor ?? defaults?.setCursor;
  const loadSnapshot = dependencies.loadSnapshot ?? defaults?.loadSnapshot;
  const getDeleteTombstones = dependencies.getDeleteTombstones ?? defaults?.getDeleteTombstones;
  const applyStudyBlock = dependencies.applyStudyBlock ?? defaults?.applyStudyBlock;
  const applyPracticeTest = dependencies.applyPracticeTest ?? defaults?.applyPracticeTest;
  const applyWeakTopic = dependencies.applyWeakTopic ?? defaults?.applyWeakTopic;
  const applyErrorLog = dependencies.applyErrorLog ?? defaults?.applyErrorLog;
  const applyDelete = dependencies.applyDelete ?? defaults?.applyDelete;
  if (
    !getCursor ||
    !saveCursor ||
    !loadSnapshot ||
    !getDeleteTombstones ||
    !applyStudyBlock ||
    !applyPracticeTest ||
    !applyWeakTopic ||
    !applyErrorLog ||
    !applyDelete
  ) {
    throw new Error("Cloud pull dependencies are unavailable.");
  }

  const since = (await getCursor()) ?? 0;
  const [snapshot, tombstones, res] = await Promise.all([
    loadSnapshot(),
    getDeleteTombstones(null),
    fetchImpl(formatPullUrl(deviceId, since), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    }),
  ]);

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Sync pull failed (${res.status})`);
  }

  const data = await parseJsonBody<CloudPullResponse>(res, "Sync pull returned invalid JSON.");
  const entities = indexLocalEntities(snapshot.state);
  const localDeletes = indexDeleteTombstones(tombstones);

  let applied = 0;
  let upserted = 0;
  let deleted = 0;
  let skipped = 0;

  for (const entry of data.entries) {
    if (!isSupportedCloudPullEntityType(entry.entityType)) {
      skipped += 1;
      continue;
    }

    const activeEntity =
      entry.entityType === "study_block"
        ? entities.study_block.get(entry.entityId)
        : entry.entityType === "practice_test"
          ? entities.practice_test.get(entry.entityId)
          : entry.entityType === "weak_topic_entry"
            ? entities.weak_topic_entry.get(entry.entityId)
            : entities.error_log_entry.get(entry.entityId);
    const deletedAt =
      entry.entityType === "study_block"
        ? localDeletes.study_block.get(entry.entityId)
        : entry.entityType === "practice_test"
          ? localDeletes.practice_test.get(entry.entityId)
          : entry.entityType === "weak_topic_entry"
            ? localDeletes.weak_topic_entry.get(entry.entityId)
            : localDeletes.error_log_entry.get(entry.entityId);

    if (entry.operation === "upsert") {
      const payload = coerceCloudPullPayload(entry.payload);
      if (!payload) {
        skipped += 1;
        continue;
      }
      if (deletedAt && compareTimestamps(deletedAt, entry.clientUpdatedAt) >= 0) {
        skipped += 1;
        continue;
      }
      if (activeEntity && compareTimestamps(activeEntity.updatedAt, entry.clientUpdatedAt) >= 0) {
        skipped += 1;
        continue;
      }

      if (entry.entityType === "study_block") {
        const block = payload as unknown as StudyBlock;
        await applyStudyBlock(block);
        entities.study_block.set(entry.entityId, block);
      } else if (entry.entityType === "practice_test") {
        const test = payload as unknown as PracticeTest;
        await applyPracticeTest(test);
        entities.practice_test.set(entry.entityId, test);
      } else if (entry.entityType === "weak_topic_entry") {
        const weakTopic = payload as unknown as WeakTopicEntry;
        await applyWeakTopic(weakTopic);
        entities.weak_topic_entry.set(entry.entityId, weakTopic);
      } else {
        const errorLog = payload as unknown as ErrorLogEntry;
        await applyErrorLog(errorLog);
        entities.error_log_entry.set(entry.entityId, errorLog);
      }

      if (entry.entityType === "study_block") {
        localDeletes.study_block.delete(entry.entityId);
      } else if (entry.entityType === "practice_test") {
        localDeletes.practice_test.delete(entry.entityId);
      } else if (entry.entityType === "weak_topic_entry") {
        localDeletes.weak_topic_entry.delete(entry.entityId);
      } else {
        localDeletes.error_log_entry.delete(entry.entityId);
      }
      applied += 1;
      upserted += 1;
      continue;
    }

    if (deletedAt && compareTimestamps(deletedAt, entry.clientUpdatedAt) >= 0) {
      skipped += 1;
      continue;
    }
    if (activeEntity && compareTimestamps(activeEntity.updatedAt, entry.clientUpdatedAt) >= 0) {
      skipped += 1;
      continue;
    }

    await applyDelete(entry.entityType, entry.entityId, entry.clientUpdatedAt);
    if (entry.entityType === "study_block") {
      entities.study_block.delete(entry.entityId);
      localDeletes.study_block.set(entry.entityId, entry.clientUpdatedAt);
    } else if (entry.entityType === "practice_test") {
      entities.practice_test.delete(entry.entityId);
      localDeletes.practice_test.set(entry.entityId, entry.clientUpdatedAt);
    } else if (entry.entityType === "weak_topic_entry") {
      entities.weak_topic_entry.delete(entry.entityId);
      localDeletes.weak_topic_entry.set(entry.entityId, entry.clientUpdatedAt);
    } else {
      entities.error_log_entry.delete(entry.entityId);
      localDeletes.error_log_entry.set(entry.entityId, entry.clientUpdatedAt);
    }
    applied += 1;
    deleted += 1;
  }

  await saveCursor(data.cursor);
  return {
    received: data.entries.length,
    applied,
    upserted,
    deleted,
    skipped,
    cursor: data.cursor,
  };
}
