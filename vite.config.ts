import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const tauriHost = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 3100,
    strictPort: true,
    host: tauriHost || undefined,
    open: !tauriHost,
  },
});
