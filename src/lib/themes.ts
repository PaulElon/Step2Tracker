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
};

export const themeList = Object.values(themes);

export function getTheme(themeId: ThemeId) {
  return themes[themeId] ?? themes.aurora;
}
