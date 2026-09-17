import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests share one DATABASE_URL; parallel files deadlock on truncate/insert.
    fileParallelism: false,
  },
});
