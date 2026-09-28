import { defineConfig } from 'vite';

// The arcade serves /api from the same origin. Locally, point it at an arcade
// API on its usual port so the leaderboard can be exercised end to end.
const arcadeApi = { '/api': 'http://127.0.0.1:3784' };

export default defineConfig({
  base: './',
  build: { target: 'es2022', sourcemap: true },
  server: { host: '127.0.0.1', port: 5173, proxy: arcadeApi },
  preview: { proxy: arcadeApi },
});
