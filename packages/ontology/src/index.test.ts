import { describe, expect, it } from 'vitest';

import { DEFAULT_MAX_TRAVERSAL_DEPTH, ONTOLOGY_SCHEMA_VERSION } from './index.js';

describe('@sourcing/ontology', () => {
  it('exposes the schema version that the store and API pin against', () => {
    expect(ONTOLOGY_SCHEMA_VERSION).toBe('0.1.0');
  });

  it('caps traversal depth at 6 by default', () => {
    expect(DEFAULT_MAX_TRAVERSAL_DEPTH).toBe(6);
  });
});
