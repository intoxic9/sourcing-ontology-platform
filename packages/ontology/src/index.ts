/**
 * @sourcing/ontology — the pure ontology core.
 *
 * Dependency budget: zod, and nothing else. No database driver, no HTTP framework, no
 * Node globals. That budget is the feature: it is what lets the Action layer, the
 * preconditions and the minimum-confidence path algebra be tested with no Postgres
 * running, and what makes this package consumable on its own. See PLAN.md §4.
 *
 * This package declares the `OntologyContext` port; `@sourcing/ontology-store-postgres`
 * implements it. The dependency arrow never points the other way.
 *
 * Week 1 contents land here per PLAN.md §9: Tracked<T> and Provenance, the five object
 * types and five link types with their Zod schemas, the path algebra, and the two
 * Actions.
 */

/**
 * The ontology schema version. Written as the single `schema_versions` row by the
 * store's initial migration (PLAN.md §5) and pinned by every consumer, so a store
 * built against an older schema fails loudly instead of writing malformed rows.
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
