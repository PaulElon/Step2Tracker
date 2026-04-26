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
  aurora: {
    id: "aurora",
    label: "Aurora",
    description: "Teal-cyan palette with cool contrast and a clear glow hierarchy.",
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
  ember: {
    id: "ember",
    label: "Ember",
    description: "Warm brass and rose palette tuned for long sessions without losing readability.",
    chart: {
      text: "#f4eadf",
      muted: "#b69d87",
      grid: "rgba(255,244,230,0.10)",
      outline: "rgba(255,244,230,0.18)",
      primary: "#ffb454",
      secondary: "#ff7e6b",
      tertiary: "#f3c8a2",
      warm: "#ffd480",
      success: "#9be4a2",
      danger: "#ff9388",
    },
    lanes: {
      review: ["#f7c6a1", "#ff9a76"],
      content: ["#ffd480", "#ffb454"],
      assessment: ["#ff7e6b", "#ffb3a2"],
      recovery: ["#9f8b7d", "#d4c0b2"],
      admin: ["#9be4a2", "#6ad0b5"],
    },
  },
  tide: {
    id: "tide",
    label: "Tide",
    description: "Blue-green Pacific palette with crisp chart contrast and softer glow edges.",
    chart: {
      text: "#deecf8",
      muted: "#8ea8bf",
      grid: "rgba(222,236,248,0.09)",
      outline: "rgba(222,236,248,0.18)",
      primary: "#6ad8ff",
      secondary: "#62f1c4",
      tertiary: "#9eb0ff",
      warm: "#ffd08a",
      success: "#7ef0b5",
      danger: "#ff97b7",
    },
    lanes: {
      review: ["#9eb0ff", "#e2b0ff"],
      content: ["#6ad8ff", "#62f1c4"],
      assessment: ["#ffd08a", "#ff97b7"],
      recovery: ["#7e93aa", "#bed0e3"],
      admin: ["#7ef0b5", "#6ad8ff"],
    },
  },
  bubblegum: {
    id: "bubblegum",
    label: "Bubblegum",
    description: "Bright pink with soft coral highlights and a high-energy, clean clinical contrast.",
    chart: {
      text: "#fff1f6",
      muted: "#cf9bb5",
      grid: "rgba(255, 241, 246, 0.09)",
      outline: "rgba(255, 241, 246, 0.18)",
      primary: "#ff69c7",
      secondary: "#ff9ad5",
      tertiary: "#ffb86b",
      warm: "#ffd18f",
      success: "#8ef0cb",
      danger: "#ff8ab0",
    },
    lanes: {
      review: ["#ff9ad5", "#ffc0ea"],
      content: ["#ff69c7", "#ff9ad5"],
      assessment: ["#ffb86b", "#ff8ab0"],
      recovery: ["#c78aa6", "#f2bfd8"],
      admin: ["#8ef0cb", "#7ce7ff"],
    },
  },
  signal: {
    id: "signal",
    label: "Signal",
    description: "Electric cyan, lime, and indigo for a crisp futuristic control-room feel.",
    chart: {
      text: "#e6fff9",
      muted: "#88b9b0",
      grid: "rgba(230, 255, 249, 0.08)",
      outline: "rgba(230, 255, 249, 0.18)",
      primary: "#4df6d4",
      secondary: "#8cfb6e",
      tertiary: "#6ea8ff",
      warm: "#ffe07a",
      success: "#8cfb6e",
      danger: "#ff7d9f",
    },
    lanes: {
      review: ["#6ea8ff", "#b08cff"],
      content: ["#4df6d4", "#8cfb6e"],
      assessment: ["#ffe07a", "#ff7d9f"],
      recovery: ["#88b9b0", "#c4ece4"],
      admin: ["#8cfb6e", "#4df6d4"],
    },
  },
  prism: {
    id: "prism",
    label: "Prism",
    description: "Iridescent neon violet and cyan with a sharper, more synthetic chart palette.",
    chart: {
      text: "#f1efff",
      muted: "#9f95c9",
      grid: "rgba(241, 239, 255, 0.08)",
      outline: "rgba(241, 239, 255, 0.18)",
      primary: "#8f7bff",
      secondary: "#58d7ff",
      tertiary: "#ff7df2",
      warm: "#ffbc6f",
      success: "#74f0c3",
      danger: "#ff86a5",
    },
    lanes: {
      review: ["#ff7df2", "#c27cff"],
      content: ["#58d7ff", "#8f7bff"],
      assessment: ["#ffbc6f", "#ff86a5"],
      recovery: ["#9f95c9", "#d5cff7"],
      admin: ["#74f0c3", "#58d7ff"],
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
  teslared: {
    id: "teslared",
    label: "Tezla Red",
    description: "Matte black with vivid crimson-red accents and bright white text.",
    chart: {
      text: "#ffffff",
      muted: "#b0b0b0",
      grid: "rgba(255,255,255,0.09)",
      outline: "rgba(255,255,255,0.16)",
      primary: "#cc0000",
      secondary: "#ff2233",
      tertiary: "#ff7088",
      warm: "#ff9500",
      success: "#4ade80",
      danger: "#cc0000",
    },
    lanes: {
      review: ["rgba(204,0,0,0.35)", "rgba(255,34,51,0.22)"],
      content: ["rgba(204,0,0,0.28)", "rgba(255,112,136,0.16)"],
      assessment: ["rgba(255,149,0,0.28)", "rgba(255,200,100,0.16)"],
      recovery: ["rgba(176,176,176,0.20)", "rgba(255,255,255,0.10)"],
      admin: ["rgba(74,222,128,0.20)", "rgba(52,211,153,0.12)"],
    },
  },
};

export const themeList = Object.values(themes);

export function getTheme(themeId: ThemeId) {
  return themes[themeId] ?? themes.aurora;
}
