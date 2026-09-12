-- 004_provenance_and_cardinality.sql
--
-- Brings the database in line with the TypeScript definitions now that they exist.
--
-- Two changes, both closing gaps where the database permitted states the ontology has
-- no way to express:
--
--   1. Provenance becomes biconditional. 001 enforced "present unless", which allows a
--      value to be both INFERRED and carry a source_record_id. Provenance is a
--      discriminated union in TypeScript, so that row has no representable type and
--      would fail Zod on the way out — a row that can be written but not read. The
--      looser direction also invites the meaning drift already rejected once: a
--      source_record_id on an INFERRED row can only be pointing at a derivation, and a
--      column that sometimes means "raw source row" and sometimes means "derived from
--      these properties" has two meanings. See PLAN.md §8.
--
--   2. AFFECTS_SUPPLIER becomes structurally many-to-one. LinkTypeDefinition records
--      the cardinality, but a cardinality nothing enforces is a comment.

-- Biconditional: source_record_id is NULL exactly when the method is INFERRED, and
-- pipeline_run_id is NULL exactly when the method is HUMAN_ENTRY. Written as equality
-- between two boolean expressions rather than a pair of implications, so each rule
-- reads as the single fact it is.
--
-- Renamed rather than redefined in place, because the old names say "unless" and would
-- misdescribe the new constraints. A constraint whose name contradicts its expression
-- is worse than no name.
ALTER TABLE object_properties
    DROP CONSTRAINT object_properties_source_record_unless_inferred,
    DROP CONSTRAINT object_properties_pipeline_run_unless_human,

    ADD CONSTRAINT object_properties_source_record_iff_not_inferred
        CHECK ((source_record_id IS NULL) = (method = 'INFERRED')),

    ADD CONSTRAINT object_properties_pipeline_run_iff_not_human
        CHECK ((pipeline_run_id IS NULL) = (method = 'HUMAN_ENTRY'));

ALTER TABLE links
    DROP CONSTRAINT links_source_record_unless_inferred,
    DROP CONSTRAINT links_pipeline_run_unless_human,

    ADD CONSTRAINT links_source_record_iff_not_inferred
        CHECK ((source_record_id IS NULL) = (method = 'INFERRED')),

    ADD CONSTRAINT links_pipeline_run_iff_not_human
        CHECK ((pipeline_run_id IS NULL) = (method = 'HUMAN_ENTRY'));

-- AFFECTS_SUPPLIER is QUALITY_EVENT -> SUPPLIER, many-to-one: many events may name one
-- supplier, so each event names at most one. from_id is the event, hence uniqueness on
-- from_id alone.
--
-- A partial unique index rather than a constraint, because a UNIQUE constraint cannot
-- carry a WHERE clause and every other link type is many-to-many. This also gives the
-- traversal a single-row lookup from an event to its supplier for free.
CREATE UNIQUE INDEX links_affects_supplier_single_target_idx
    ON links (from_id)
    WHERE link_type = 'AFFECTS_SUPPLIER';
