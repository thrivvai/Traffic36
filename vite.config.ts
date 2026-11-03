import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import netlify from "@netlify/vite-plugin";

// The Netlify plugin runs functions and a local Postgres inside the Vite dev server.
export default defineConfig({
  plugins: [react(), netlify()],
});
