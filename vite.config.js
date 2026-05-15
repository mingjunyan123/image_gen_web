import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/image/",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    proxy: process.env.VITE_NEW_API_ORIGIN
      ? {
          "/image-api": {
            target: process.env.VITE_NEW_API_ORIGIN,
            changeOrigin: true,
          },
          "/images": {
            target: process.env.VITE_NEW_API_ORIGIN,
            changeOrigin: true,
          },
        }
      : undefined,
  },
});
