import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // The API runs on its own port; the page calls /api on the same origin.
    proxy: { "/api": "http://localhost:3000" },
  },
});
