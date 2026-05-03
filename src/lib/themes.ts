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
  dark: {
    id: "dark",
    label: "Dark",
    description: "Deep charcoal palette with teal-cyan accents and cool contrast.",
    chart: {
      text: "#d8e7f5",
      muted: "#7f93aa",
      grid: "rgba(255,255,255,0.08)",
      outline: "rgba(255,255,255,0.16)",
      primary: "#60f3df",
      secondary: "#7ab8ff",
      tertiary: "#d7a4ff",
      warm: "#ffc37a",
      success: "#7ff2b4",
      danger: "#ff8f9e",
    },
    lanes: {
      review: ["#d7a4ff", "#ffb6d5"],
      content: ["#60f3df", "#7ab8ff"],
      assessment: ["#ffc37a", "#ff8f9e"],
      recovery: ["#94a8be", "#c3d1df"],
      admin: ["#7ff2b4", "#60f3df"],
    },
  },
  light: {
    id: "light",
    label: "Light",
    description: "Clean light theme with white background and neutral blue accents.",
    chart: {
      text: "#1e293b",
      muted: "#64748b",
      grid: "rgba(30,41,59,0.08)",
      outline: "rgba(30,41,59,0.15)",
      primary: "#3b82f6",
      secondary: "#6366f1",
      tertiary: "#8b5cf6",
      warm: "#f59e0b",
      success: "#10b981",
      danger: "#ef4444",
    },
    lanes: {
      review: ["#6366f1", "#8b5cf6"],
      content: ["#3b82f6", "#06b6d4"],
      assessment: ["#f59e0b", "#ef4444"],
      recovery: ["#94a3b8", "#cbd5e1"],
      admin: ["#10b981", "#3b82f6"],
    },
  },
  paulblue: {
    id: "paulblue",
    label: "Paul Blue",
    description: "Bold royal blue with vivid electric-blue accents and crisp white text.",
    chart: {
      text: "#dbeafe",
      muted: "#6099d4",
      grid: "rgba(219,234,254,0.09)",
      outline: "rgba(219,234,254,0.18)",
      primary: "#2563eb",
      secondary: "#60a5fa",
      tertiary: "#a78bfa",
      warm: "#fbbf24",
      success: "#34d399",
      danger: "#f87171",
    },
    lanes: {
      review: ["#a78bfa", "#c4b5fd"],
      content: ["#2563eb", "#60a5fa"],
      assessment: ["#fbbf24", "#f87171"],
      recovery: ["#6099d4", "#bfdbfe"],
      admin: ["#34d399", "#2563eb"],
    },
  },
  maggiepink: {
    id: "maggiepink",
    label: "Maggie Pink",
    description: "Bright rose light-mode palette with deep charcoal text and high contrast.",
    chart: {
      text: "#1a0a10",
      muted: "#8b4d6a",
      grid: "rgba(26,10,16,0.08)",
      outline: "rgba(26,10,16,0.15)",
      primary: "#c20065",
      secondary: "#ff5fa3",
      tertiary: "#8b1a5c",
      warm: "#d4600a",
      success: "#0a7a45",
      danger: "#b00000",
    },
    lanes: {
      review: ["rgba(194,0,101,0.22)", "rgba(255,95,163,0.14)"],
      content: ["rgba(255,130,170,0.22)", "rgba(255,180,200,0.14)"],
      assessment: ["rgba(212,96,10,0.22)", "rgba(255,150,90,0.14)"],
      recovery: ["rgba(180,120,150,0.18)", "rgba(230,195,210,0.10)"],
      admin: ["rgba(10,122,69,0.18)", "rgba(120,200,160,0.10)"],
    },
  },
};

export const themeList = Object.values(themes);

export function getTheme(themeId: ThemeId) {
  return themes[themeId] ?? themes.dark;
}
