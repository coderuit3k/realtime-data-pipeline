import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0B0F17",
        surface: "#111827",
        surfaceHigh: "#1C2028",
        surfaceHighest: "#262A33",
        border: "rgba(255, 255, 255, 0.08)",
        borderStrong: "rgba(255, 255, 255, 0.12)",
        accent: "#06B6D4",
        accentBright: "#4CD7F6",
        secondary: "#6366F1",
        secondaryBright: "#8B5CF6",
        textPrimary: "#DFE2EE",
        textSecondary: "#BCC9CD",
        textMuted: "#869397",
        success: "#10B981",
        warning: "#F59E0B",
        error: "#EF4444",
        sidebarBg: "#0A0E16",
        textFaint: "#3D494C",
      },
      boxShadow: {
        glowCyan: "0 0 16px rgba(6, 182, 212, 0.4)",
        glowIndigo: "0 0 14px rgba(99, 102, 241, 0.4)",
        glowEmerald: "0 0 12px rgba(16, 185, 129, 0.35)",
        glassPanel: "0 8px 32px rgba(0, 0, 0, 0.5)",
      },
      fontFamily: {
        // One typeface across the whole app -- font-mono kept as an alias
        // (rather than stripping it from every usage) so existing
        // font-mono classes on data/labels still resolve, just to Inter.
        heading: ["var(--font-inter)"],
        body: ["var(--font-inter)"],
        mono: ["var(--font-inter)"],
      },
      keyframes: {
        flowDot: {
          "0%, 10%": { transform: "translateX(0)", opacity: "0" },
          "25%": { opacity: "1" },
          "80%": { opacity: "1" },
          "100%": { transform: "translateX(22px)", opacity: "0" },
        },
      },
      animation: {
        flowDot: "flowDot 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
