import { defineConfig } from 'vitest/config';

// Tests use a separate, throw-away database so they never touch your development data.
// PERINEXA_TEST_DB lets two copies of the project run their tests at the same time, each on its own database
// (the name must still end in "_test" – tests/helpers.js refuses any other).
const testDb = process.env.PERINEXA_TEST_DB || 'perinexa_test';

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      MONGO_URI: `mongodb://127.0.0.1:27017/${testDb}`,
      JWT_SECRET: 'test-only-secret-that-is-long-enough-1234567890',
      LOGIN_RATE_LIMIT_MAX: '1000',
      // Never the real OpenAI key from server/.env: AI tests set a fake one and replace OpenAI with a stand-in.
      OPENAI_API_KEY: '',
      // Tests freeze the clock, so a kept Analytics page would never expire: off, except where a test turns it on.
      ANALYTICS_CACHE_SECONDS: '0',
      ANALYTICS_PLATFORM_CACHE_SECONDS: '0',
    },
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000, // the first run on a new test database builds every index (about half a minute)
  },
});
