import { defineConfig } from '@playwright/test';

// Runs against a production build (fixtures excluded, matching the deployed
// site) so the real seed data is what the smoke test exercises.
export default defineConfig({
  testDir: './tests/e2e',
  webServer: {
    command: 'npm run preview -- --port 4321 --host 127.0.0.1',
    url: 'http://127.0.0.1:4321',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:4321',
  },
});
