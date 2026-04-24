import type { StudyBlock } from "../types/models";
import { formatDateTimeLabel } from "./datetime";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

function toTimestamp(value?: string | null) {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function getDueStudyBlockReminders(blocks: StudyBlock[], now = Date.now()) {
  return blocks
    .filter((block) => {
      if (block.completed) {
        return false;
      }

      const reminderAt = toTimestamp(block.reminderAt);
      if (reminderAt === null || reminderAt > now) {
        return false;
      }

      const reminderSentAt = toTimestamp(block.reminderSentAt);
      return reminderSentAt === null || reminderSentAt < reminderAt;
    })
    .sort((left, right) => {
      const leftReminder = toTimestamp(left.reminderAt) ?? 0;
      const rightReminder = toTimestamp(right.reminderAt) ?? 0;
      return leftReminder - rightReminder || left.task.localeCompare(right.task);
    });
}

export function formatReminderBody(block: StudyBlock) {
  const reminderLabel = block.reminderAt ? formatDateTimeLabel(block.reminderAt) : "";
  return reminderLabel ? `${block.category} · ${reminderLabel}` : block.category;
}

export async function getNotificationPermissionStatus() {
  try {
    return (await isPermissionGranted()) ? ("granted" as const) : ("denied" as const);
  } catch {
    return "unsupported" as const;
  }
}

export async function requestNotificationPermission() {
  try {
    if (await isPermissionGranted()) {
      return "granted" as const;
    }

    return requestPermission();
  } catch {
    return "unsupported" as const;
  }
}

export function sendNativeReminder(title: string, body: string) {
  try {
    sendNotification({ title, body });
    return true;
  } catch {
    return false;
  }
}

export function sendReminderNotification(block: StudyBlock) {
  return sendNativeReminder(block.task, formatReminderBody(block));
}
