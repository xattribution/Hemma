import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: {
        name: "Hemma — Family Calendar",
        short_name: "Hemma",
        description: "Your family's calendar, chores and lists — all in one cozy place.",
        theme_color: "#fdf8f0",
        background_color: "#fdf8f0",
        display: "standalone",
        orientation: "any",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    host: true, // reachable from other devices on the LAN during dev
    proxy: {
      "/api": {
        target: "http://localhost:49733",
        ws: true,
      },
    },
  },
});
