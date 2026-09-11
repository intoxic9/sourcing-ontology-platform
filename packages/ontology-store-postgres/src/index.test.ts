import { ONTOLOGY_SCHEMA_VERSION } from '@sourcing/ontology';
import { describe, expect, it } from 'vitest';

import { SUPPORTED_SCHEMA_VERSION } from './index.js';

describe('@sourcing/ontology-store-postgres', () => {
  it('is built against the current ontology schema version', () => {
    expect(SUPPORTED_SCHEMA_VERSION).toBe(ONTOLOGY_SCHEMA_VERSION);
  });
});
