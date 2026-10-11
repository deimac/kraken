/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/player/',
  plugins: [react()],
  server: { port: 5174, proxy: { '/api': 'http://localhost:3000' } },
  test: { environment: 'jsdom' },
});
