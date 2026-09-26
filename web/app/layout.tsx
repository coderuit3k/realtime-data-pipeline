import type { Metadata } from "next";
import localFont from "next/font/local";
import Sidebar from "@/components/Sidebar";
import "./globals.css";

// Self-hosted (not next/font/google) -- the CI runner's build step hit a
// recurring `next/font/google` crash ("Cannot read properties of null
// (reading '1')" in @next/font's loader) fetching from Google's font API,
// while local builds and Vercel's own build both succeeded every time.
// Vendoring the exact same files Google serves removes that build-time
// network dependency entirely. Each entry below points at the same
// variable-font file with a different `weight`, matching how Google's own
// served CSS declares multiple weights against one variable file.
const inter = localFont({
  src: [
    { path: "./fonts/Inter-Variable.woff2", weight: "400" },
    { path: "./fonts/Inter-Variable.woff2", weight: "500" },
    { path: "./fonts/Inter-Variable.woff2", weight: "600" },
    { path: "./fonts/Inter-Variable.woff2", weight: "700" },
  ],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "DataPulse",
  description: "Real-time data pipeline dashboard & RAG assistant",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={inter.variable}>
      <body>
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </body>
    </html>
  );
}
