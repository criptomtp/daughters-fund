import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Окремий конфіг, щоб у тестовий запуск не тягнувся vite.config.js із PWA-плагіном.
// Два середовища: чиста математика в node, монтування застосунку в jsdom.
export default defineConfig({
  plugins: [react()],
  define: { __BUILD_ID__: JSON.stringify("test") },
  test: {
    include: ["tests/**/*.test.js", "tests/**/*.test.jsx"],
    environmentMatchGlobs: [["tests/boot.test.jsx", "jsdom"]],
    environment: "node",
  },
});
