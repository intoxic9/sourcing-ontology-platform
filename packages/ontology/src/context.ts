import type { z } from 'zod';

import type { Link, LinkTypeName } from './link-types.js';
// Type-only: `objectSchemas` is referenced solely through `typeof` below, so the pure
// core does not pull the schema values in just to describe their inferred types.
import type { objectSchemas, ObjectTypeName } from './object-types.js';
import type { TraversalQuery, TraversalResult } from './traversal.js';

/** The assembled object for a given type name, derived from the Zod schema. */
export type ObjectOf<T extends ObjectTypeName> = z.infer<(typeof objectSchemas)[T]>;

export type LinkQuery = {
  /** Matches links in either direction — `objectId` may be the from or the to end. */
  objectId: string;
  linkType?: LinkTypeName;
};

/**
 * Thrown when a caller names an object that is not there.
 *
 * A distinct error rather than an empty result, because "no such supplier" and "this
 * supplier affects nothing" are different answers and a risk tool must not render them
 * the same way. The API maps this to 404; an empty `targets` array is a 200.
 */
export class UnknownObjectError extends Error {
  constructor(
    readonly objectType: ObjectTypeName,
    readonly id: string,
  ) {
    super(`no ${objectType} with id ${id}`);
    this.name = 'UnknownObjectError';
  }
}

/**
 * The port the ontology core needs from storage. Declared here in the pure core and
 * implemented by `@sourcing/ontology-store-postgres`; the dependency arrow never points
 * the other way (PLAN.md §4).
 *
 * Read-only. Writes arrive with the Action layer, which is a different concern with a
 * different set of guarantees: reads are free, writes are governed.
 */
export type OntologyContext = {
  /**
   * Typed by what the caller expects rather than returning a union to narrow. Finding a
   * PART under an id the caller asked for as a SUPPLIER is a bug rather than a miss, so
   * that throws `UnknownObjectError` instead of returning undefined; a genuinely absent
   * id returns undefined.
   */
  getObject<T extends ObjectTypeName>(
    objectType: T,
    id: string,
  ): Promise<ObjectOf<T> | undefined>;

  /**
   * One hop, both directions. Kept separate from pattern traversal so Action
   * preconditions read as link lookups rather than graph walks.
   */
  getLinks(query: LinkQuery): Promise<readonly Link[]>;

  /** Throws `UnknownObjectError` if `query.from` does not exist. */
  traverse(query: TraversalQuery): Promise<TraversalResult>;
};
