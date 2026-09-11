import { describe, expect, it } from 'vitest';

import { buildServer } from './index.js';

describe('@sourcing/api', () => {
  it('serves /health without a database connection', async () => {
    const app = buildServer({ logger: false });
    try {
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: 'ok' });
    } finally {
      await app.close();
    }
  });
});
