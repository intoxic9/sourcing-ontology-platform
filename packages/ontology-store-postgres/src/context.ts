import {
  assertValidTraversalProfile,
  collapseToTargets,
  linkSchema,
  makePath,
  objectSchemas,
  objectTypeDefinition,
  UnknownObjectError,
  type Link,
  type LinkQuery,
  type ObjectOf,
  type ObjectTypeName,
  type OntologyContext,
  type PathNode,
  type PathStep,
  type Provenance,
  type ProvenanceMethod,
  type Tracked,
  type TraversalQuery,
  type TraversalResult,
} from '@sourcing/ontology';

import type { Queryable } from './repository.js';
import { buildPatternTraverseSql } from './pattern-sql.js';

const SELECT_PROPERTIES = `
    SELECT property_name, ordinal, value, confidence,
           source_system, source_record_id, pipeline_run_id, extracted_at, method,
           verified_by, verified_at
      FROM object_properties
     WHERE object_id = $1
     ORDER BY property_name, ordinal
`;

const SELECT_LINKS = `
    SELECT id, link_type, from_id, to_id, confidence,
           source_system, source_record_id, pipeline_run_id, extracted_at, method,
           verified_by, verified_at
      FROM links
     WHERE (from_id = $1 OR to_id = $1)
       AND ($2::text IS NULL OR link_type = $2::text)
     ORDER BY id
`;

type EvidenceRow = {
  confidence: string;
  source_system: string;
  source_record_id: string | null;
  pipeline_run_id: string | null;
  extracted_at: Date;
  method: ProvenanceMethod;
  verified_by: string | null;
  verified_at: Date | null;
};

type PropertyRow = EvidenceRow & {
  property_name: string;
  ordinal: number;
  value: unknown;
};

type LinkRow = EvidenceRow & {
  id: string;
  link_type: string;
  from_id: string;
  to_id: string;
};

type TraversalRow = {
  paths: unknown;
};

function asPathSteps(raw: unknown): readonly PathStep[] {
  if (!Array.isArray(raw)) {
    throw new Error(`traversal returned a path that is not an array: ${typeof raw}`);
  }

  return raw.map((item) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error('traversal returned a step that is not an object');
    }

    const step = item as Record<string, unknown>;
    const to = step['to'];
    if (typeof to !== 'object' || to === null) {
      throw new Error('traversal returned a step with no target');
    }

    const node = to as Record<string, unknown>;
    const confidence = step['confidence'];
    return {
      linkId: String(step['linkId']),
      linkType: step['linkType'] as PathStep['linkType'],
      direction: step['direction'] as PathStep['direction'],
      confidence: typeof confidence === 'number' ? confidence : Number(confidence),
      to: { id: String(node['id']), objectType: node['objectType'] as PathStep['to']['objectType'] },
    };
  });
}

function toConfidence(raw: string): number {
  const value = Number(raw);
  if (Number.isNaN(value)) throw new Error(`confidence ${raw} is not a number`);
  return value;
}

function required(value: string | null, column: string): string {
  if (value === null) {
    throw new Error(`${column} is null on a row whose method requires it`);
  }
  return value;
}

function toProvenance(row: EvidenceRow): Provenance {
  const common = { sourceSystem: row.source_system, extractedAt: row.extracted_at.toISOString() };

  switch (row.method) {
    case 'HUMAN_ENTRY':
      return {
        ...common,
        method: row.method,
        sourceRecordId: required(row.source_record_id, 'source_record_id'),
      };
    case 'INFERRED':
      return {
        ...common,
        method: row.method,
        pipelineRunId: required(row.pipeline_run_id, 'pipeline_run_id'),
      };
    default:
      return {
        ...common,
        method: row.method,
        sourceRecordId: required(row.source_record_id, 'source_record_id'),
        pipelineRunId: required(row.pipeline_run_id, 'pipeline_run_id'),
      };
  }
}

function toTracked(row: PropertyRow): Tracked<unknown> {
  const verification =
    row.verified_by === null || row.verified_at === null
      ? undefined
      : { by: row.verified_by, at: row.verified_at.toISOString() };

  return {
    value: row.value,
    confidence: toConfidence(row.confidence),
    provenance: toProvenance(row),
    ...(verification === undefined ? {} : { verification }),
  };
}

export function createPostgresContext(db: Queryable): OntologyContext {
  async function objectTypeOf(id: string): Promise<ObjectTypeName | undefined> {
    const found = await db.query<{ object_type: ObjectTypeName }>(
      'SELECT object_type FROM objects WHERE id = $1',
      [id],
    );
    return found.rows[0]?.object_type;
  }

  async function getObject<T extends ObjectTypeName>(
    objectType: T,
    id: string,
  ): Promise<ObjectOf<T> | undefined> {
    const stored = await objectTypeOf(id);
    if (stored === undefined) return undefined;
    if (stored !== objectType) throw new UnknownObjectError(objectType, id);

    const { rows } = await db.query<PropertyRow>(SELECT_PROPERTIES, [id]);
    const assembled: Record<string, unknown> = { id };

    for (const definition of objectTypeDefinition(objectType).properties) {
      const matching = rows.filter((row) => row.property_name === definition.name);

      if (definition.cardinality === 'MULTIPLE') {
        assembled[definition.name] = matching.map(toTracked);
        continue;
      }

      const single = matching[0];
      if (single !== undefined) assembled[definition.name] = toTracked(single);
    }

    return objectSchemas[objectType].parse(assembled) as ObjectOf<T>;
  }

  async function getLinks(query: LinkQuery): Promise<readonly Link[]> {
    const { rows } = await db.query<LinkRow>(SELECT_LINKS, [
      query.objectId,
      query.linkType ?? null,
    ]);

    return rows.map((row) => {
      const verification =
        row.verified_by === null || row.verified_at === null
          ? undefined
          : { by: row.verified_by, at: row.verified_at.toISOString() };

      return linkSchema.parse({
        id: row.id,
        linkType: row.link_type,
        fromId: row.from_id,
        toId: row.to_id,
        confidence: toConfidence(row.confidence),
        provenance: toProvenance(row),
        ...(verification === undefined ? {} : { verification }),
      });
    });
  }

  async function traverse(query: TraversalQuery): Promise<TraversalResult> {
    const stored = await objectTypeOf(query.from.id);
    if (stored === undefined || stored !== query.from.objectType) {
      throw new UnknownObjectError(query.from.objectType, query.from.id);
    }

    assertValidTraversalProfile(query.from.objectType, query.profile);

    const sql = buildPatternTraverseSql(query.profile);
    const { rows } = await db.query<TraversalRow>(sql, [query.from.id]);

    const row = rows[0];
    if (row === undefined) throw new Error('traversal returned no row');

    const source: PathNode = { id: query.from.id, objectType: query.from.objectType };
    const rawPaths = Array.isArray(row.paths) ? row.paths : [];
    const paths = rawPaths.map((steps) => makePath(source, asPathSteps(steps)));

    return { targets: collapseToTargets(paths), profile: query.profile };
  }

  return { getObject, getLinks, traverse };
}
