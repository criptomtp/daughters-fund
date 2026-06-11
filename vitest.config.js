import { defineConfig } from "vitest/config";

// Standalone config so the app's vite.config.js (with the PWA plugin) is not
// pulled into the test run. The money math is pure JS — node env is enough.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
  },
});
