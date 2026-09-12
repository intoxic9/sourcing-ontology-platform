import { z } from 'zod';

import { objectTypeNameSchema, type ObjectTypeName } from './object-types.js';
import {
  evidenceShape,
  VERIFIED_IMPLIES_CERTAIN_MESSAGE,
  verifiedImpliesCertain,
} from './tracked.js';

export const linkTypeNameSchema = z.enum([
  'SUPPLIES',
  'COMPOSED_OF',
  'MANUFACTURED_AT',
  'AFFECTS_SUPPLIER',
  'AFFECTS_PART',
]);
export type LinkTypeName = z.infer<typeof linkTypeNameSchema>;

export const linkCardinalitySchema = z.enum(['MANY_TO_ONE', 'MANY_TO_MANY']);
export type LinkCardinality = z.infer<typeof linkCardinalitySchema>;

export type LinkTypeDefinition = {
  name: LinkTypeName;
  from: ObjectTypeName;
  to: ObjectTypeName;
  cardinality: LinkCardinality;
};

/**
 * Declared rather than derived, because a link type's endpoints are not expressible in
 * the Zod schema of either endpoint — the relationship lives between the types, not in
 * them. `ONTOLOGY.md` §4 is the source.
 *
 * `MANY_TO_ONE` is enforced in the database by a partial unique index on `from_id`
 * (migration 004). Without that the cardinality recorded here would be decorative.
 */
export const linkTypeDefinitions = [
  { name: 'SUPPLIES', from: 'SUPPLIER', to: 'PART', cardinality: 'MANY_TO_MANY' },
  { name: 'COMPOSED_OF', from: 'DEVICE', to: 'PART', cardinality: 'MANY_TO_MANY' },
  { name: 'MANUFACTURED_AT', from: 'DEVICE', to: 'SITE', cardinality: 'MANY_TO_MANY' },

  // A quality event affects exactly one supplier, so each event has at most one
  // outgoing edge of this type.
  {
    name: 'AFFECTS_SUPPLIER',
    from: 'QUALITY_EVENT',
    to: 'SUPPLIER',
    cardinality: 'MANY_TO_ONE',
  },

  { name: 'AFFECTS_PART', from: 'QUALITY_EVENT', to: 'PART', cardinality: 'MANY_TO_MANY' },
] as const satisfies readonly LinkTypeDefinition[];

/**
 * One row of the `links` table. `linkType` determines both endpoint types, which is why
 * `from_type`/`to_type` are not stored — two columns that can drift from the link type
 * that already implies them.
 */
export const linkSchema = z
  .strictObject({
    id: z.string().min(1),
    linkType: linkTypeNameSchema,
    fromId: z.string().min(1),
    toId: z.string().min(1),
    ...evidenceShape,
  })
  .refine(verifiedImpliesCertain, { error: VERIFIED_IMPLIES_CERTAIN_MESSAGE });
export type Link = z.infer<typeof linkSchema>;

export const objectTypeNames = objectTypeNameSchema.options;
export const linkTypeNames = linkTypeNameSchema.options;
