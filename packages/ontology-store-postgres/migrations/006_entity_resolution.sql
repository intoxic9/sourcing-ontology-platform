-- 006_entity_resolution.sql
--
-- Week 2 entity resolution persistence:
--   - Tombstones on objects (merged_into_id) — duplicate rows stay for audit addressing
--   - object_source_keys — source keys are searchable, not canonical ids
--   - merge_proposals — ER candidates; confirmSupplierMerge applies merges
--   - ingestion_runs — batch ingest metadata and data-quality summary
--
-- Opaque UUIDs for ingested objects; seed fixtures keep human-readable ids.
-- Link confidence on re-ingest: LEAST(existing, incoming) in the repository, audited there.
-- object_type = SUPPLIER for merges enforced in Action preconditions, not triggers.

-- ---------------------------------------------------------------------------
-- objects — merge tombstones
-- ---------------------------------------------------------------------------

ALTER TABLE objects
    ADD COLUMN merged_into_id text NULL
        REFERENCES objects (id) ON DELETE RESTRICT,
    ADD COLUMN merged_at timestamptz NULL;

ALTER TABLE objects
    ADD CONSTRAINT objects_merged_not_self
        CHECK (merged_into_id IS NULL OR merged_into_id <> id),

    ADD CONSTRAINT objects_merged_at_pair
        CHECK (
            (merged_into_id IS NULL AND merged_at IS NULL)
            OR (merged_into_id IS NOT NULL AND merged_at IS NOT NULL)
        );

CREATE INDEX objects_merged_into_idx
    ON objects (merged_into_id)
    WHERE merged_into_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- object_source_keys — (source_system, source_key) → object_id
-- ---------------------------------------------------------------------------

CREATE TABLE object_source_keys (
    source_system   text        NOT NULL,
    source_key      text        NOT NULL,
    object_id       text        NOT NULL
                                REFERENCES objects (id) ON DELETE RESTRICT,
    pipeline_run_id text        NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT object_source_keys_pkey
        PRIMARY KEY (source_system, source_key),

    CONSTRAINT object_source_keys_source_key_not_blank
        CHECK (source_key <> ''),

    CONSTRAINT object_source_keys_source_system_not_blank
        CHECK (source_system <> '')
);

CREATE INDEX object_source_keys_object_idx
    ON object_source_keys (object_id);

-- ---------------------------------------------------------------------------
-- merge_proposals — supplier merge candidates (confirmSupplierMerge)
-- ---------------------------------------------------------------------------

CREATE TABLE merge_proposals (
    id                    uuid              NOT NULL DEFAULT gen_random_uuid(),
    survivor_id           text              NOT NULL
                                            REFERENCES objects (id) ON DELETE RESTRICT,
    duplicate_id          text              NOT NULL
                                            REFERENCES objects (id) ON DELETE RESTRICT,
    score                 confidence_score  NOT NULL,
    features              jsonb             NOT NULL,
    status                text              NOT NULL,
    pipeline_run_id       text              NOT NULL,
    created_at            timestamptz       NOT NULL DEFAULT now(),
    resolved_at           timestamptz       NULL,
    resolution_audit_id   uuid              NULL
                                            REFERENCES audit_records (id) ON DELETE RESTRICT,

    CONSTRAINT merge_proposals_pkey PRIMARY KEY (id),

    CONSTRAINT merge_proposals_status_known
        CHECK (status IN ('PENDING', 'CONFIRMED', 'REJECTED')),

    CONSTRAINT merge_proposals_distinct_ids
        CHECK (survivor_id <> duplicate_id),

    CONSTRAINT merge_proposals_resolved_pair
        CHECK (
            (status = 'PENDING' AND resolved_at IS NULL AND resolution_audit_id IS NULL)
            OR (status IN ('CONFIRMED', 'REJECTED') AND resolved_at IS NOT NULL)
        )
);

CREATE UNIQUE INDEX merge_proposals_one_pending_per_duplicate
    ON merge_proposals (duplicate_id)
    WHERE status = 'PENDING';

CREATE INDEX merge_proposals_status_idx
    ON merge_proposals (status, created_at DESC);

CREATE INDEX merge_proposals_survivor_idx
    ON merge_proposals (survivor_id);

-- ---------------------------------------------------------------------------
-- ingestion_runs — batch ingest metadata and data-quality summary
-- ---------------------------------------------------------------------------

CREATE TABLE ingestion_runs (
    id                text        NOT NULL,
    started_at        timestamptz NOT NULL DEFAULT now(),
    finished_at       timestamptz NULL,
    summary           jsonb       NOT NULL DEFAULT '{}'::jsonb,
    audit_record_id   uuid        NULL
                                  REFERENCES audit_records (id) ON DELETE RESTRICT,

    CONSTRAINT ingestion_runs_pkey PRIMARY KEY (id),

    CONSTRAINT ingestion_runs_id_not_blank
        CHECK (id <> ''),

    CONSTRAINT ingestion_runs_finished_pair
        CHECK (
            (finished_at IS NULL)
            OR (finished_at IS NOT NULL AND finished_at >= started_at)
        )
);

CREATE INDEX ingestion_runs_started_idx
    ON ingestion_runs (started_at DESC);
