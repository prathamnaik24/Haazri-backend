import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use the Node environment (not jsdom)
    environment: 'node',
    // Give each test 30 seconds — DB operations can be slow on first run
    testTimeout: 30000,
    // Run test files sequentially to avoid DB race conditions
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      }
    },
    // Glob pattern for test files
    include: ['tests/**/*.test.js'],
  },
});
