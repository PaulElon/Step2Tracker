import { methodKeyFromLabel } from "./tf-session-adapters";
import type { TfSessionLog } from "../types/models";

export interface NativeTrackerSpanInput {
  device_id?: string | null;
  span_id?: string | null;
  start_ts?: number | string | null;
  end_ts?: number | string | null;
  bundle_id?: string | null;
  name?: string | null;
  title?: string | null;
  host?: string | null;
  url?: string | null;
  kind?: string | null;
  hint_label?: string | null;
  [key: string]: unknown;
}

export interface NativeSpanAckKey {
  device_id: string;
  span_id: string;
  log_id: string;
}

export interface NativeSpanReconcileResult {
  newEntries: TfSessionLog[];
  skipped: number;
  ackKeys: NativeSpanAckKey[];
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toHours(durationMs: number): number {
  return Math.round((durationMs / 3600000) * 100) / 100;
}

function makeLogId(deviceId: string, spanId: string): string {
  return `nat-${deviceId}-${spanId}`;
}

export function reconcileNativeSpansToSessions(
  spans: NativeTrackerSpanInput[],
  existingSessionLogs: TfSessionLog[]
): NativeSpanReconcileResult {
  const existingIds = new Set(existingSessionLogs.map((session) => session.id));
  const seenSpanKeys = new Set<string>();
  const newEntries: TfSessionLog[] = [];
  const ackKeys: NativeSpanAckKey[] = [];
  let skipped = 0;

  for (const span of spans) {
    const deviceId = typeof span.device_id === "string" ? span.device_id.trim() : "";
    const spanId = typeof span.span_id === "string" ? span.span_id.trim() : "";
    const startTs = toFiniteNumber(span.start_ts);
    const endTs = toFiniteNumber(span.end_ts);
    const name = typeof span.name === "string" ? span.name.trim() : "";
    const bundleId = typeof span.bundle_id === "string" ? span.bundle_id.trim() : "";

    if (!deviceId || !spanId || startTs === null || endTs === null || endTs <= startTs || (!name && !bundleId)) {
      skipped += 1;
      continue;
    }

    const dedupeKey = `${deviceId}:${spanId}`;
    if (seenSpanKeys.has(dedupeKey)) {
      skipped += 1;
      continue;
    }
    seenSpanKeys.add(dedupeKey);

    const id = makeLogId(deviceId, spanId);
    ackKeys.push({ device_id: deviceId, span_id: spanId, log_id: id });

    if (existingIds.has(id)) {
      skipped += 1;
      continue;
    }

    const startDate = new Date(startTs);
    const endDate = new Date(endTs);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      skipped += 1;
      continue;
    }

    const method =
      (typeof span.hint_label === "string" && span.hint_label.trim()) ||
      name ||
      bundleId ||
      "Auto-Tracked";

    const title = typeof span.title === "string" ? span.title.trim() : "";
    const notes = `[AUTO] ${name || bundleId}${title ? ` — ${title}` : ""}`;

    newEntries.push({
      id,
      date: startDate.toISOString().slice(0, 10),
      method,
      methodKey: methodKeyFromLabel(method),
      hours: toHours(endTs - startTs),
      startISO: startDate.toISOString(),
      endISO: endDate.toISOString(),
      notes,
      isDistraction: span.kind === "distraction",
      isLive: false,
    });
    existingIds.add(id);
  }

  return { newEntries, skipped, ackKeys };
}
