import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0B1120",
        surface: "#131B2E",
        border: "#1E2A47",
        accent: "#2DD4BF",
        textPrimary: "#E8ECF6",
        textSecondary: "#93A0C2",
        textMuted: "#5C6892",
        success: "#34D399",
        warning: "#F5A524",
        error: "#F0576B",
        sidebarBg: "#0E1626",
        textFaint: "#3D4874",
      },
      fontFamily: {
        heading: ["var(--font-space-grotesk)"],
        body: ["var(--font-work-sans)"],
        mono: ["var(--font-ibm-plex-mono)"],
      },
    },
  },
  plugins: [],
};

export default config;
