import type { Queryable } from './repository.js';

/**
 * Clears all mutable ontology graph and governance rows. Preserves schema_versions
 * (and schema_migrations). Order follows FK dependencies (children before parents):
 *
 *   ingestion_runs.audit_record_id        → audit_records
 *   merge_proposals.resolution_audit_id   → audit_records
 *   merge_proposals.survivor/duplicate_id → objects
 *   audit_record_objects                  → audit_records, objects
 *   object_source_keys.object_id          → objects
 *   links.from_id / to_id                 → objects
 *   object_properties.object_id           → objects
 *   objects.merged_into_id                → objects (self)
 *
 * schema_versions.audit_record_id → audit_records (nullable; left untouched — migration
 * rows use NULL). audit_records.schema_version → schema_versions (parents kept).
 */
export async function truncateOntologyData(db: Queryable): Promise<void> {
  await db.query('TRUNCATE ingestion_runs');

  await db.query('TRUNCATE merge_proposals');

  await db.query('TRUNCATE audit_record_objects');

  await db.query('TRUNCATE object_source_keys');

  await db.query('TRUNCATE links');

  await db.query('TRUNCATE object_properties');

  await db.query(`
      UPDATE objects
         SET merged_into_id = NULL,
             merged_at = NULL
  `);

  await db.query('DELETE FROM audit_records');

  // DELETE, not TRUNCATE: objects.merged_into_id self-FK blocks TRUNCATE without CASCADE.
  await db.query('DELETE FROM objects');
}

/** Fixed run metadata so `pnpm db:seed` is reproducible on a fresh database. */
export const DEMO_WEEK2_PIPELINE_RUN_ID = 'week2-demo-seed';
export const DEMO_WEEK2_EXTRACTED_AT = '2026-09-17T12:00:00.000Z';
