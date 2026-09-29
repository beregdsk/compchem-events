/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

// getViteConfig adds Astro's Vite plugins, so tests can render .astro
// components through the container API (tests/components).
export default getViteConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
