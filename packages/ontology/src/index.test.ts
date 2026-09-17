import { describe, expect, it } from 'vitest';

import { ONTOLOGY_SCHEMA_VERSION, SUPPLIER_DEVICE_RISK, terminalObjectType } from './index.js';

describe('@sourcing/ontology', () => {
  it('exposes the schema version that the store and API pin against', () => {
    expect(ONTOLOGY_SCHEMA_VERSION).toBe('0.2.0');
  });

  it('pairs supplier device risk pattern with DEVICE terminal type', () => {
    expect(terminalObjectType('SUPPLIER', SUPPLIER_DEVICE_RISK.pattern)).toBe('DEVICE');
    expect(SUPPLIER_DEVICE_RISK.to).toBe('DEVICE');
  });
});
