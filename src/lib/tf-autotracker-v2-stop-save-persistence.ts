import type { TfAutotrackerV2FinalizedPreviewSession } from "./tf-autotracker-v2-reducer-preview.js";
import type { TfSessionLog } from "../types/models";

export async function persistAutoTrackerV2StopSaveSelection({
  previewSessions,
  toSessionLog,
  upsertSessionLog,
  onPreviewSessionPersisted,
  clearSavedRunState,
}: {
  previewSessions: readonly TfAutotrackerV2FinalizedPreviewSession[];
  toSessionLog: (previewSession: TfAutotrackerV2FinalizedPreviewSession) => TfSessionLog;
  upsertSessionLog: (sessionLog: TfSessionLog) => Promise<unknown>;
  onPreviewSessionPersisted?: (previewSessionId: string) => void;
  clearSavedRunState: () => Promise<void>;
}): Promise<void> {
  for (const previewSession of previewSessions) {
    const sessionLog = toSessionLog(previewSession);
    await upsertSessionLog(sessionLog);
    onPreviewSessionPersisted?.(previewSession.previewSessionId);
  }

  await clearSavedRunState();
}
