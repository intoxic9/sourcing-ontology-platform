/**
 * The ontology schema version. Written as the single `schema_versions` row and pinned by
 * every consumer, so a store built against an older schema fails loudly instead of
 * writing malformed rows.
 *
 * Lives in its own module rather than in index.ts because the contract emit needs it and
 * index.ts re-exports the contract emit; importing it from there would be a cycle.
 */
export const ONTOLOGY_SCHEMA_VERSION = '0.1.0';
