import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Each test file boots its own PGlite; under parallel load startup can exceed the 10s default.
  test: { hookTimeout: 60_000 },
});
