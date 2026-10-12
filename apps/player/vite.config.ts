/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/player/',
  build: { target: 'es2017', cssTarget: 'chrome61' },
  server: { port: 5174, proxy: { '/api': 'http://localhost:3000' } },
  test: { environment: 'jsdom', include: ['test/**/*.test.ts'] },
});
