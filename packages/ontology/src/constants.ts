/**
 * The ontology schema version. Written as the single `schema_versions` row and pinned by
 * every consumer, so a store built against an older schema fails loudly instead of
 * writing malformed rows.
 *
 * Lives in its own module rather than in index.ts because the contract emit needs it and
 * index.ts re-exports the contract emit; importing it from there would be a cycle.
 */
export const ONTOLOGY_SCHEMA_VERSION = '0.1.0';

/**
 * Default depth cap for graph traversal, and the reason it exists: cycle detection via
 * the path array stops a loop revisiting a node, but a dense BOM graph is acyclic and
 * can still fan out combinatorially. Callers get a `truncated` flag when this bites,
 * because a partial risk answer that presents itself as complete is worse than an
 * error. See PLAN.md §5.
 */
export const DEFAULT_MAX_TRAVERSAL_DEPTH = 6;
