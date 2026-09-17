import type { IngestPlan } from '@sourcing/ontology';
import type { LinkInput } from '@sourcing/ontology';
import type { Queryable } from '../repository.js';
import {
  addressAuditObjects,
  insertAuditRecord,
  insertLink,
  insertObject,
} from '../repository.js';

const INSERT_SOURCE_KEY = `
    INSERT INTO object_source_keys (source_system, source_key, object_id, pipeline_run_id)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (source_system, source_key) DO NOTHING
`;

const SELECT_SOURCE_KEY = `
    SELECT osk.object_id, o.merged_into_id
      FROM object_source_keys osk
      JOIN objects o ON o.id = osk.object_id
     WHERE osk.source_system = $1 AND osk.source_key = $2
`;

const SELECT_LINK = `
    SELECT id, confidence::float8 AS confidence
      FROM links
     WHERE link_type = $1 AND from_id = $2 AND to_id = $3
`;

const UPDATE_LINK_CONFIDENCE = `
    UPDATE links
       SET confidence = LEAST(confidence, $2::confidence_score),
           pipeline_run_id = $3,
           extracted_at = $4,
           source_system = $5,
           source_record_id = $6,
           method = $7
     WHERE id = $1
`;

const INSERT_RUN = `
    INSERT INTO ingestion_runs (id, summary)
    VALUES ($1, $2::jsonb)
`;

const FINISH_RUN = `
    UPDATE ingestion_runs
       SET finished_at = now(),
           summary = $2::jsonb,
           audit_record_id = $3
     WHERE id = $1
`;

function toLinkInput(link: IngestPlan['links'][number]): LinkInput {
  return {
    linkType: link.linkType,
    fromId: link.fromId,
    toId: link.toId,
    confidence: link.confidence,
    provenance: link.provenance,
    ...(link.verification === undefined ? {} : { verification: link.verification }),
  };
}

export async function resolveIngestObjectId(
  db: Queryable,
  sourceSystem: string,
  sourceKey: string,
): Promise<string | undefined> {
  const { rows } = await db.query<{ object_id: string; merged_into_id: string | null }>(
    SELECT_SOURCE_KEY,
    [sourceSystem, sourceKey],
  );
  const row = rows[0];
  if (row === undefined) return undefined;
  return row.merged_into_id ?? row.object_id;
}

export async function registerSourceKey(
  db: Queryable,
  sourceSystem: string,
  sourceKey: string,
  objectId: string,
  pipelineRunId: string,
): Promise<void> {
  await db.query(INSERT_SOURCE_KEY, [sourceSystem, sourceKey, objectId, pipelineRunId]);
}

async function upsertLinkLeast(
  db: Queryable,
  link: IngestPlan['links'][number],
  pipelineRunId: string,
): Promise<void> {
  const existing = await db.query<{ id: string; confidence: number }>(SELECT_LINK, [
    link.linkType,
    link.fromId,
    link.toId,
  ]);
  const row = existing.rows[0];
  if (row === undefined) {
    await insertLink(db, toLinkInput(link));
    return;
  }

  const incoming = link.confidence;
  const prov = link.provenance;
  await db.query(UPDATE_LINK_CONFIDENCE, [
    row.id,
    incoming,
    'pipelineRunId' in prov ? prov.pipelineRunId : pipelineRunId,
    prov.extractedAt,
    prov.sourceSystem,
    'sourceRecordId' in prov ? prov.sourceRecordId : null,
    prov.method,
  ]);
}

export async function applyIngestPlan(
  db: Queryable,
  plan: IngestPlan,
  pipelineRunId: string,
  reportSummary: unknown,
): Promise<{ auditId: string }> {
  await db.query(INSERT_RUN, [pipelineRunId, JSON.stringify({ phase: 'running' })]);

  const objectIds: string[] = [];

  for (const supplier of plan.suppliers) {
    const existing = await resolveIngestObjectId(
      db,
      'SAP_VENDOR_MASTER',
      supplier.sourceKey,
    );
    if (existing === undefined) {
      await insertObject(db, 'SUPPLIER', supplier.data);
      await registerSourceKey(
        db,
        'SAP_VENDOR_MASTER',
        supplier.sourceKey,
        supplier.id,
        pipelineRunId,
      );
    }
    objectIds.push(supplier.id);
  }

  for (const part of plan.parts) {
    const existing = await resolveIngestObjectId(db, 'SAP_MATERIAL_MASTER', part.sourceKey);
    if (existing === undefined) {
      await insertObject(db, 'PART', part.data);
      await registerSourceKey(
        db,
        'SAP_MATERIAL_MASTER',
        part.sourceKey,
        part.id,
        pipelineRunId,
      );
    }
    objectIds.push(part.id);
  }

  for (const device of plan.devices) {
    const existing = await resolveIngestObjectId(db, 'SAP_DEVICE_MASTER', device.sourceKey);
    if (existing === undefined) {
      await insertObject(db, 'DEVICE', device.data);
      await registerSourceKey(
        db,
        'SAP_DEVICE_MASTER',
        device.sourceKey,
        device.id,
        pipelineRunId,
      );
    }
    objectIds.push(device.id);
  }

  for (const link of plan.links) {
    await upsertLinkLeast(db, link, pipelineRunId);
  }

  const audit = await insertAuditRecord(db, {
    actionName: 'ingestSapWeek2',
    actor: 'system-ingest',
    actorType: 'HUMAN',
    status: 'EXECUTED',
    justification: `Week 2 SAP CSV ingest (${pipelineRunId})`,
    inputPayload: { pipelineRunId, reportSummary },
    beforeState: null,
    afterState: {
      objectCount: objectIds.length,
      linkCount: plan.links.length,
    },
  });
  await addressAuditObjects(db, audit.id, [...new Set(objectIds)]);

  await db.query(FINISH_RUN, [pipelineRunId, JSON.stringify(reportSummary), audit.id]);

  return { auditId: audit.id };
}
