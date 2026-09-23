import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0B0F17",
        surface: "#111827",
        border: "rgba(255, 255, 255, 0.08)",
        accent: "#06B6D4",
        secondary: "#6366F1",
        textPrimary: "#DFE2EE",
        textSecondary: "#BCC9CD",
        textMuted: "#869397",
        success: "#10B981",
        warning: "#F59E0B",
        error: "#EF4444",
        sidebarBg: "#0A0E16",
        textFaint: "#3D494C",
      },
      fontFamily: {
        heading: ["var(--font-inter)"],
        body: ["var(--font-inter)"],
        mono: ["var(--font-jetbrains-mono)"],
      },
    },
  },
  plugins: [],
};

export default config;
