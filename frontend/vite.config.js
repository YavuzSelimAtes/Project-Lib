import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// API_TARGET: backend adresi (varsayilan 4000). PORT: vite portu (varsayilan 5173).
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT) || 5173,
    proxy: { '/api': process.env.API_TARGET || 'http://127.0.0.1:4000' },
  },
});
