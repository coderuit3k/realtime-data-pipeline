import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: { environment: "node" },
  // Mirror tsconfig's "@/*" path so tests import modules the same way the app does.
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
