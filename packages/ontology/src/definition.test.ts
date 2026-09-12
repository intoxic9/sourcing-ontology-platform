import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  deriveObjectTypeDefinition,
  objectTypeDefinition,
  objectTypeDefinitions,
  type ObjectTypeDefinition,
  type PropertyDefinition,
} from './definition.js';
import { linkTypeDefinitions } from './link-types.js';
import { objectTypeNameSchema } from './object-types.js';
import { tracked } from './tracked.js';

function property(definition: ObjectTypeDefinition, name: string): PropertyDefinition {
  const found = definition.properties.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`${definition.name} has no property ${name}`);
  return found;
}

describe('objectTypeDefinitions', () => {
  it('covers every object type name exactly once', () => {
    expect(objectTypeDefinitions.map((definition) => definition.name)).toStrictEqual([
      ...objectTypeNameSchema.options,
    ]);
  });

  // id lives in objects.id, not in object_properties. If it leaked into the definition
  // the repository would try to write a property row for it.
  it('excludes id from every type', () => {
    for (const definition of objectTypeDefinitions) {
      expect(definition.properties.map((p) => p.name)).not.toContain('id');
    }
  });

  it('gives every property a value type and a mutability', () => {
    for (const definition of objectTypeDefinitions) {
      expect(definition.properties.length).toBeGreaterThan(0);
      for (const candidate of definition.properties) {
        expect(candidate.valueType).toBeDefined();
        expect(candidate.mutability).toBeDefined();
      }
    }
  });
});

describe('derived property shapes', () => {
  const supplier = objectTypeDefinition('SUPPLIER');

  it('reads cardinality from z.array', () => {
    expect(property(supplier, 'certifications')).toMatchObject({
      valueType: 'STRING',
      cardinality: 'MULTIPLE',
      required: true,
    });
  });

  it('reads requiredness from .optional()', () => {
    expect(property(supplier, 'duns')).toMatchObject({
      cardinality: 'SINGLE',
      required: false,
    });
    expect(property(supplier, 'legalName').required).toBe(true);
  });

  it('reads enum members from z.enum', () => {
    expect(property(supplier, 'tier').enumValues).toStrictEqual([
      'TIER_1',
      'TIER_2',
      'TIER_3',
    ]);
    expect(property(supplier, 'legalName').enumValues).toBeUndefined();
  });

  it('reads mutability from .meta()', () => {
    expect(property(supplier, 'status').mutability).toBe('ACTION_ONLY');
    expect(property(supplier, 'legalName').mutability).toBe('INGESTION');
  });

  it('maps scalar value types', () => {
    expect(property(supplier, 'qualityRating').valueType).toBe('NUMBER');
    expect(property(objectTypeDefinition('PART'), 'requiresRequalification')).toMatchObject({
      valueType: 'BOOLEAN',
      mutability: 'ACTION_ONLY',
    });
  });

  // The only thing separating a timestamp from a string in the emitted schema.
  it('distinguishes TIMESTAMP from STRING via format', () => {
    const event = objectTypeDefinition('QUALITY_EVENT');
    expect(property(event, 'openedAt').valueType).toBe('TIMESTAMP');
    expect(property(event, 'closedAt')).toMatchObject({
      valueType: 'TIMESTAMP',
      required: false,
    });
    expect(property(event, 'description').valueType).toBe('STRING');
  });
});

describe('deriveObjectTypeDefinition rejects malformed declarations', () => {
  it('rejects an optional MULTIPLE property', () => {
    const schema = z.strictObject({
      id: z.string(),
      certifications: z.array(tracked(z.string())).optional(),
    });
    expect(() => deriveObjectTypeDefinition('SUPPLIER', schema)).toThrow(
      /must not be optional/,
    );
  });

  it('rejects a property that is not wrapped in tracked()', () => {
    const schema = z.strictObject({ id: z.string(), legalName: z.string() });
    expect(() => deriveObjectTypeDefinition('SUPPLIER', schema)).toThrow(
      /wrapped in tracked/,
    );
  });

  it('rejects a value type the ontology cannot store', () => {
    const schema = z.strictObject({
      id: z.string(),
      address: tracked(z.strictObject({ city: z.string() })),
    });
    expect(() => deriveObjectTypeDefinition('SUPPLIER', schema)).toThrow(/value_type/);
  });

  it('rejects an unknown mutability', () => {
    const schema = z.strictObject({
      id: z.string(),
      status: tracked(z.string()).meta({ mutability: 'SOMETIMES' }),
    });
    expect(() => deriveObjectTypeDefinition('SUPPLIER', schema)).toThrow(/unknown mutability/);
  });
});

describe('linkTypeDefinitions', () => {
  it('declares every link with both endpoints', () => {
    expect(linkTypeDefinitions).toHaveLength(5);
    for (const link of linkTypeDefinitions) {
      expect(objectTypeNameSchema.options).toContain(link.from);
      expect(objectTypeNameSchema.options).toContain(link.to);
    }
  });

  // Enforced by the partial unique index on links (from_id) in migration 004.
  it('makes AFFECTS_SUPPLIER the only many-to-one link', () => {
    const manyToOne = linkTypeDefinitions
      .filter((link) => link.cardinality === 'MANY_TO_ONE')
      .map((link) => link.name);
    expect(manyToOne).toStrictEqual(['AFFECTS_SUPPLIER']);
  });
});
