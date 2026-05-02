import type { ThemeId } from "../types/models";

export interface ThemeDefinition {
  id: ThemeId;
  label: string;
  description: string;
  chart: {
    text: string;
    muted: string;
    grid: string;
    outline: string;
    primary: string;
    secondary: string;
    tertiary: string;
    warm: string;
    success: string;
    danger: string;
  };
  lanes: {
    review: [string, string];
    content: [string, string];
    assessment: [string, string];
    recovery: [string, string];
    admin: [string, string];
  };
}

export const themes: Record<ThemeId, ThemeDefinition> = {
  light: {
    id: "light",
    label: "Light",
    description: "Clean light mode matching mainstream apps like Claude, ChatGPT, and Linear.",
    chart: {
      text: "#111827",
      muted: "#4B5563",
      grid: "rgba(17,24,39,0.08)",
      outline: "rgba(17,24,39,0.14)",
      primary: "#2563EB",
      secondary: "#6366F1",
      tertiary: "#8B5CF6",
      warm: "#F59E0B",
      success: "#10B981",
      danger: "#EF4444",
    },
    lanes: {
      review: ["#6366F1", "#8B5CF6"],
      content: ["#2563EB", "#06B6D4"],
      assessment: ["#F59E0B", "#EF4444"],
      recovery: ["#9CA3AF", "#D1D5DB"],
      admin: ["#10B981", "#2563EB"],
    },
  },
  dark: {
    id: "dark",
    label: "Dark",
    description: "Mainstream dark mode matching X, ChatGPT, Claude, and Google dark themes.",
    chart: {
      text: "#F9FAFB",
      muted: "#9CA3AF",
      grid: "rgba(249,250,251,0.08)",
      outline: "rgba(249,250,251,0.14)",
      primary: "#3B82F6",
      secondary: "#6366F1",
      tertiary: "#8B5CF6",
      warm: "#F59E0B",
      success: "#10B981",
      danger: "#EF4444",
    },
    lanes: {
      review: ["#6366F1", "#8B5CF6"],
      content: ["#3B82F6", "#06B6D4"],
      assessment: ["#F59E0B", "#EF4444"],
      recovery: ["#6B7280", "#9CA3AF"],
      admin: ["#10B981", "#3B82F6"],
    },
  },
  maggiepink: {
    id: "maggiepink",
    label: "Maggie Pink",
    description: "Super girly hot pink. Light mode default with dark rose variant.",
    chart: {
      text: "#1A0414",
      muted: "#9D4E72",
      grid: "rgba(26,4,20,0.08)",
      outline: "rgba(26,4,20,0.14)",
      primary: "#DB2777",
      secondary: "#F472B6",
      tertiary: "#C084FC",
      warm: "#F97316",
      success: "#059669",
      danger: "#B91C1C",
    },
    lanes: {
      review: ["#DB2777", "#EC4899"],
      content: ["#F472B6", "#FDA4AF"],
      assessment: ["#F97316", "#FB923C"],
      recovery: ["#C084FC", "#DDD6FE"],
      admin: ["#059669", "#34D399"],
    },
  },
  paulblue: {
    id: "paulblue",
    label: "Paul Blue",
    description: "Sports navy — think Patriots, Cowboys, Warriors. Dark navy default with light sky variant.",
    chart: {
      text: "#EFF6FF",
      muted: "#60A5FA",
      grid: "rgba(239,246,255,0.08)",
      outline: "rgba(239,246,255,0.14)",
      primary: "#2563EB",
      secondary: "#6366F1",
      tertiary: "#8B5CF6",
      warm: "#F59E0B",
      success: "#10B981",
      danger: "#EF4444",
    },
    lanes: {
      review: ["#6366F1", "#8B5CF6"],
      content: ["#2563EB", "#3B82F6"],
      assessment: ["#F59E0B", "#EF4444"],
      recovery: ["#60A5FA", "#93C5FD"],
      admin: ["#10B981", "#2563EB"],
    },
  },
};

export const themeList = Object.values(themes);

export function getTheme(themeId: ThemeId) {
  return themes[themeId] ?? themes.light;
}
