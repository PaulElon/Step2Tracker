// @ts-expect-error TS5097: node --test needs the explicit .ts specifier in this runtime path.
import { methodKeyFromLabel, splitAutoSessionMethodLabel } from "./tf-session-adapters.ts";
import type { TfSessionLog } from "../types/models";

export interface CanonicalSessionLogEntry {
  schemaVersion: 1;
  id: string;
  date: string;
  title: string;
  category: string;
  source: "manual" | "imported";
  durationMinutes: number;
  startAt: string;
  endAt: string;
  notes: string;
  isDistraction: boolean;
  updatedAt: string;
}

export type CanonicalSessionLogClassificationReason =
  | "safeManual"
  | "nativeSession"
  | "liveSession"
  | "autoDerivedMethod"
  | "autoDerivedNotes"
  | "missingMethod";

export interface CanonicalSessionLogClassification {
  reason: CanonicalSessionLogClassificationReason;
  exportable: boolean;
  entry: CanonicalSessionLogEntry | null;
}

const FALLBACK_UPDATED_AT = "1970-01-01T00:00:00.000Z";

function normalizeUpdatedAt(session: TfSessionLog): string {
  const updatedAt = session.updatedAt?.trim();
  if (updatedAt) {
    return updatedAt;
  }
  if (session.endISO.trim()) {
    return session.endISO.trim();
  }
  if (session.startISO.trim()) {
    return session.startISO.trim();
  }
  if (/^\d{4}-\d{2}-\d{2}$/u.test(session.date.trim())) {
    return `${session.date.trim()}T00:00:00.000Z`;
  }
  return FALLBACK_UPDATED_AT;
}

function sanitizeExportedNotes(notes: string): { isSafe: boolean; value: string } {
  const trimmed = notes.trim();
  if (!trimmed) {
    return { isSafe: true, value: "" };
  }

  if (
    /^\[AUTO\]/u.test(trimmed) ||
    /(https?:\/\/|www\.|browserUrl=|browserTitle=|windowTitle=|sourceEventIds=|sourceSpanIds=|previewSessionId=|bundleId=|matchedRuleTarget=)/iu.test(
      trimmed,
    )
  ) {
    return { isSafe: false, value: "" };
  }

  return { isSafe: true, value: trimmed };
}

function inferDurationMinutes(session: TfSessionLog): number {
  const startMs = Date.parse(session.startISO);
  const endMs = Date.parse(session.endISO);
  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
    return Math.round((endMs - startMs) / 60000);
  }
  return Math.max(0, Math.round(session.hours * 60));
}

export function classifyTfSessionLogForCanonicalExport(
  session: TfSessionLog,
): CanonicalSessionLogClassification {
  const method = session.method.trim();
  const { label, isAuto } = splitAutoSessionMethodLabel(method);
  if (session.id.startsWith("nat-")) {
    return { reason: "nativeSession", exportable: false, entry: null };
  }
  if (session.isLive) {
    return { reason: "liveSession", exportable: false, entry: null };
  }
  if (isAuto) {
    return { reason: "autoDerivedMethod", exportable: false, entry: null };
  }
  if (!label) {
    return { reason: "missingMethod", exportable: false, entry: null };
  }

  const sanitizedNotes = sanitizeExportedNotes(session.notes);
  if (!sanitizedNotes.isSafe) {
    return { reason: "autoDerivedNotes", exportable: false, entry: null };
  }

  const title = label;
  return {
    reason: "safeManual",
    exportable: true,
    entry: {
      schemaVersion: 1,
      id: session.id,
      date: session.date,
      title,
      category: methodKeyFromLabel(title),
      source: "manual",
      durationMinutes: inferDurationMinutes(session),
      startAt: session.startISO,
      endAt: session.endISO,
      notes: sanitizedNotes.value,
      isDistraction: session.isDistraction,
      updatedAt: normalizeUpdatedAt(session),
    },
  };
}

export function buildCanonicalSessionLogExport(
  sessions: TfSessionLog[],
): CanonicalSessionLogEntry[] {
  return sessions
    .map((session) => classifyTfSessionLogForCanonicalExport(session))
    .flatMap((classification) => (classification.exportable && classification.entry ? [classification.entry] : []));
}
