import { describe, expect, it } from 'vitest';

import { ONTOLOGY_SCHEMA_VERSION } from './constants.js';
import { buildContract, serializeContract } from './contract.js';
import { linkTypeDefinitions } from './link-types.js';
import { objectTypeNameSchema } from './object-types.js';

const contract = buildContract();

describe('contract document', () => {
  it('declares the ontology version the schema_versions row uses', () => {
    expect(contract['x-ontologyVersion']).toBe(ONTOLOGY_SCHEMA_VERSION);
  });

  it('defines every object type plus Link', () => {
    expect(Object.keys(contract.$defs)).toStrictEqual([
      'Provenance',
      'Verification',
      'Supplier',
      'Part',
      'Device',
      'Site',
      'QualityEvent',
      'Link',
    ]);
  });

  it('records the canonical object type name alongside the PascalCase key', () => {
    for (const name of objectTypeNameSchema.options) {
      const pascal = name
        .split('_')
        .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
        .join('');
      expect(contract.$defs[pascal]?.['x-objectType']).toBe(name);
    }
  });

  it('carries the link topology', () => {
    expect(contract['x-linkTypes']).toStrictEqual(linkTypeDefinitions);
  });
});

describe('shared definitions', () => {
  // The reason Provenance and Verification carry an `id`. Without it each of the ~35
  // tracked properties inlines the whole discriminated union.
  it('references Provenance and Verification rather than inlining them', () => {
    const supplier = contract.$defs['Supplier'];
    const legalName = (supplier?.properties as Record<string, Record<string, unknown>>)[
      'legalName'
    ];
    const properties = legalName?.['properties'] as Record<string, unknown>;

    expect(properties['provenance']).toStrictEqual({ $ref: '#/$defs/Provenance' });
    expect(properties['verification']).toStrictEqual({ $ref: '#/$defs/Verification' });
  });

  it('resolves every internal $ref to something present in $defs', () => {
    const refs = [...JSON.stringify(contract).matchAll(/"\$ref":"#\/\$defs\/([^"]+)"/g)].map(
      (match) => match[1],
    );

    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(Object.keys(contract.$defs)).toContain(ref);
    }
  });

  // $defs and $schema belong to the document, not to an entry inside it.
  it('does not repeat document-level keys inside entries', () => {
    for (const definition of Object.values(contract.$defs)) {
      expect(definition['$defs']).toBeUndefined();
      expect(definition['$schema']).toBeUndefined();
    }
  });
});

describe('serializeContract', () => {
  it('is deterministic, so the drift check is meaningful', () => {
    expect(serializeContract()).toBe(serializeContract());
  });

  it('ends with exactly one newline', () => {
    const text = serializeContract();
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.includes('\r')).toBe(false);
  });
});
