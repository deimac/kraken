/// <reference types="vitest/config" />
import legacy from '@vitejs/plugin-legacy';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/player/',
  // Older smart-TV engines (Tizen 2–3, webOS ≤ 3) lack ES modules: they load a separate legacy bundle.
  plugins: [legacy({ targets: ['chrome >= 38', 'safari >= 9'] })],
  server: { port: 5174, proxy: { '/api': 'http://localhost:3000' } },
  test: { environment: 'jsdom', include: ['test/**/*.test.ts'] },
});
