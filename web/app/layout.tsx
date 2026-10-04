import type { Metadata } from "next";
import localFont from "next/font/local";
import Sidebar from "@/components/Sidebar";
import "./globals.css";

// Self-hosted instead of next/font/google: fetching from Google's font API
// crashed the CI build intermittently ("Cannot read properties of null
// (reading '1')"), so the same files are vendored to remove that network
// dependency. Every weight points at one variable font, as Google's own CSS does.
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

/** Root shell: persistent sidebar beside a scrollable content area. UI copy is Vietnamese, hence lang="vi". */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={inter.variable}>
      <body>
        <div className="flex min-h-screen flex-col lg:flex-row">
          <Sidebar />
          <main className="min-w-0 flex-1 overflow-auto">{children}</main>
        </div>
      </body>
    </html>
  );
}
