import { z } from 'zod';

import { objectSchemas, type ObjectTypeName } from './object-types.js';

export type ValueType = 'STRING' | 'NUMBER' | 'BOOLEAN' | 'TIMESTAMP';
export type Cardinality = 'SINGLE' | 'MULTIPLE';
export type Mutability = 'INGESTION' | 'ACTION_ONLY';

export type PropertyDefinition = {
  name: string;
  valueType: ValueType;
  cardinality: Cardinality;
  /** Always `true` for `MULTIPLE`, which is present-and-empty rather than absent. */
  required: boolean;
  enumValues?: readonly string[];
  mutability: Mutability;
};

export type ObjectTypeDefinition = {
  name: ObjectTypeName;
  properties: readonly PropertyDefinition[];
};

/** The one unwrapped field. Lives in `objects.id`, never in `object_properties`. */
const IDENTITY_PROPERTY = 'id';

/**
 * Zod's own JSON Schema type rather than a hand-rolled one, so an upgrade that changes
 * the emitted shape is a compile error here instead of a runtime surprise.
 */
type SchemaNode = z.core.JSONSchema.BaseSchema;

/**
 * JSON Schema permits `true`/`false` as whole subschemas and `items` as a tuple, so
 * Zod's type is a union. Neither form is reachable from the schemas in this package;
 * narrowing here rather than asserting means an unexpected shape names itself.
 */
function subschema(candidate: unknown, context: string): SchemaNode {
  if (typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)) {
    return candidate as SchemaNode;
  }
  throw new Error(`${context}: expected a JSON Schema object, found ${typeof candidate}`);
}

function valueTypeOf(node: SchemaNode, context: string): ValueType {
  switch (node.type) {
    case 'string':
      // The only thing distinguishing a timestamp from a string, which is why
      // timestamps are declared with `z.iso.datetime()` and not `z.string()`.
      return node.format === 'date-time' ? 'TIMESTAMP' : 'STRING';
    case 'number':
    case 'integer':
      return 'NUMBER';
    case 'boolean':
      return 'BOOLEAN';
    default:
      throw new Error(
        `${context}: cannot map JSON Schema type ${JSON.stringify(node.type)} to a value_type`,
      );
  }
}

function mutabilityOf(node: SchemaNode, context: string): Mutability {
  if (node.mutability === undefined) return 'INGESTION';
  if (node.mutability === 'ACTION_ONLY' || node.mutability === 'INGESTION') {
    return node.mutability;
  }
  throw new Error(
    `${context}: unknown mutability ${JSON.stringify(node.mutability)}; expected INGESTION or ACTION_ONLY`,
  );
}

function enumValuesOf(node: SchemaNode): readonly string[] | undefined {
  const members = node.enum;
  if (members === undefined) return undefined;
  const values = members.filter((member): member is string => typeof member === 'string');
  // A partially non-string enum is not something this ontology can express, so report
  // nothing rather than a silently truncated member list.
  return values.length === members.length ? values : undefined;
}

/**
 * Projects an `ObjectTypeDefinition` out of a Zod schema, with JSON Schema as the
 * intermediate representation.
 *
 * `z.toJSONSchema()` is public, stable API, whereas Zod's internal `def` is neither and
 * would break on a minor upgrade. Routing through it also makes the artifact Python
 * already needs load-bearing rather than a side-product: if the emit is wrong, the
 * definition is wrong, and the conformance check fails. See PLAN.md §7.
 *
 * Everything needed survives the round trip — `z.array(...)` gives cardinality,
 * `.optional()` gives requiredness, `z.enum([...])` gives the members,
 * `z.iso.datetime()` gives `format: 'date-time'`, and `.meta({ mutability })` rides
 * along as a sibling keyword. The only bespoke knowledge here is our own convention:
 * a property's value type sits at `properties.value` inside the `Tracked` wrapper.
 */
export function deriveObjectTypeDefinition(
  name: ObjectTypeName,
  schema: z.ZodType,
): ObjectTypeDefinition {
  const root: SchemaNode = z.toJSONSchema(schema);
  const nodes = root.properties ?? {};
  const required = new Set(root.required ?? []);

  const properties: PropertyDefinition[] = [];

  for (const [propertyName, rawNode] of Object.entries(nodes)) {
    if (propertyName === IDENTITY_PROPERTY) continue;

    const context = `${name}.${propertyName}`;
    const node = subschema(rawNode, context);
    const isArray = node.type === 'array';
    const cardinality: Cardinality = isArray ? 'MULTIPLE' : 'SINGLE';

    // A multiple property must be present-and-empty rather than absent, so that no
    // consumer writes `supplier.certifications?.length`. Catching it here means the
    // rule is enforced at the declaration instead of trusted.
    if (isArray && !required.has(propertyName)) {
      throw new Error(
        `${context}: a MULTIPLE property must not be optional; an empty array is how it says "none"`,
      );
    }

    const trackedNode = isArray ? subschema(node.items, `${context}[]`) : node;
    const rawValueNode = trackedNode.properties?.['value'];
    if (rawValueNode === undefined) {
      throw new Error(`${context}: every property must be wrapped in tracked()`);
    }
    const valueNode = subschema(rawValueNode, `${context}.value`);

    const enumValues = enumValuesOf(valueNode);
    properties.push({
      name: propertyName,
      valueType: valueTypeOf(valueNode, context),
      cardinality,
      required: required.has(propertyName),
      mutability: mutabilityOf(node, context),
      ...(enumValues === undefined ? {} : { enumValues }),
    });
  }

  return { name, properties };
}

/**
 * The persisted schema. Written as the single `schema_versions` row and compared against
 * that row by the conformance check.
 */
export const objectTypeDefinitions: readonly ObjectTypeDefinition[] = Object.entries(
  objectSchemas,
).map(([name, schema]) =>
  deriveObjectTypeDefinition(name as ObjectTypeName, schema as z.ZodType),
);

export function objectTypeDefinition(name: ObjectTypeName): ObjectTypeDefinition {
  const found = objectTypeDefinitions.find((definition) => definition.name === name);
  if (found === undefined) throw new Error(`no definition for object type ${name}`);
  return found;
}
