import type { PracticeTest } from "../types/models";

export const PRACTICE_TEST_SOURCE_VALUES = [
  "NBME",
  "UWSA",
  "CMS",
  "Free 120",
  "Amboss",
  "UWorld",
  "TrueLearn",
  "Other",
] as const;

function trimString(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }

  return "";
}

function getCanonicalSource(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");

  if (normalized.includes("nbme")) {
    return "NBME";
  }

  if (normalized.includes("uwsa")) {
    return "UWSA";
  }

  if (normalized.includes("cms")) {
    return "CMS";
  }

  if (normalized.includes("free 120") || normalized.includes("free120")) {
    return "Free 120";
  }

  if (normalized.includes("amboss")) {
    return "Amboss";
  }

  if (normalized.includes("uworld")) {
    return "UWorld";
  }

  if (normalized.includes("truelearn") || normalized.includes("true learn")) {
    return "TrueLearn";
  }

  if (normalized.includes("other")) {
    return "Other";
  }

  return "";
}

export function resolvePracticeTestSource(source: unknown, legacyTestType?: unknown) {
  const explicitSource = trimString(source);
  if (explicitSource) {
    return getCanonicalSource(explicitSource) || "Other";
  }

  const fallbackSource = trimString(legacyTestType);
  return getCanonicalSource(fallbackSource) || "Other";
}

export function getPracticeTestLabel(test: Pick<PracticeTest, "source" | "form">) {
  return [trimString(test.source), trimString(test.form)].filter(Boolean).join(" · ") || "Practice test";
}

export function getPracticeTestSourceOptions() {
  return [...PRACTICE_TEST_SOURCE_VALUES];
}
