import {
  collapseToTargets,
  linkSchema,
  makePath,
  objectSchemas,
  objectTypeDefinition,
  resolveMaxDepth,
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

/**
 * Enumerates paths and reports truncation. Everything downstream of that — max-of-min
 * per target, `pathCount`, best-path selection, the weakest link — is done by the pure
 * algebra in `@sourcing/ontology`, shared with the in-memory context.
 *
 * That split is deliberate and is what keeps the two implementations honest: the only
 * things SQL decides are which paths exist and whether the search was cut short, so
 * those are the only things that can disagree. The conformance check compares the full
 * result of both.
 *
 * `eligible` unions the links in both directions, because reaching a Device from a Part
 * means crossing COMPOSED_OF against its declared direction (ONTOLOGY.md §4). The
 * `visited` array is the cycle detection, and seeding it with the source is also what
 * keeps the source out of its own results.
 *
 * Path confidence is *not* accumulated as `LEAST(...)` here. Each step already carries
 * its hop confidence, and `makePath` is the single owner of the minimum. A running
 * `LEAST` in SQL would be a second implementation of the same function, which is how
 * the CTE and the algebra would silently drift.
 */
const TRAVERSE = `
WITH RECURSIVE eligible AS (
        SELECT from_id AS node_id, to_id AS other_id,
               id, link_type, confidence, 'ALONG' AS direction
          FROM links
         WHERE link_type = ANY($2::text[])
         UNION ALL
        SELECT to_id AS node_id, from_id AS other_id,
               id, link_type, confidence, 'AGAINST' AS direction
          FROM links
         WHERE link_type = ANY($2::text[])
),
walk AS (
        SELECT $1::text            AS node_id,
               ARRAY[$1::text]     AS visited,
               0                   AS depth,
               '[]'::jsonb         AS steps
         UNION ALL
        SELECT e.other_id,
               w.visited || e.other_id,
               w.depth + 1,
               w.steps || jsonb_build_array(jsonb_build_object(
                   'linkId',     e.id::text,
                   'linkType',   e.link_type,
                   'direction',  e.direction,
                   'confidence', e.confidence::float8,
                   'to', jsonb_build_object('id', target.id, 'objectType', target.object_type)
               ))
          FROM walk w
          JOIN eligible e   ON e.node_id = w.node_id
          JOIN objects target ON target.id = e.other_id
         WHERE w.depth < $3::int
           AND NOT (e.other_id = ANY(w.visited))
)
SELECT
    COALESCE((
        SELECT jsonb_agg(w.steps ORDER BY w.depth, w.node_id)
          FROM walk w
          JOIN objects o ON o.id = w.node_id
         WHERE w.depth > 0
           AND o.object_type = $4::text
    ), '[]'::jsonb) AS paths,

    -- Truncation, translated one-for-one from the in-memory walk: a row that sat at the
    -- cap while an eligible edge to a node not already on its path went uncrossed. The
    -- same join and the same cycle predicate as the recursive term above.
    EXISTS (
        SELECT 1
          FROM walk w
          JOIN eligible e ON e.node_id = w.node_id
         WHERE w.depth = $3::int
           AND NOT (e.other_id = ANY(w.visited))
    ) AS truncated
`;

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
  truncated: boolean;
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

/**
 * `numeric` arrives as a string, because node-postgres will not silently lose precision
 * on a type that can hold more than a double. `confidence_score` is `numeric(4,3)`, so
 * the conversion is exact.
 */
function toConfidence(raw: string): number {
  const value = Number(raw);
  if (Number.isNaN(value)) throw new Error(`confidence ${raw} is not a number`);
  return value;
}

function required(value: string | null, column: string): string {
  if (value === null) {
    // Migration 004's biconditional CHECKs make this unreachable; reaching it means the
    // constraints were dropped or bypassed, which is worth saying out loud.
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
    // Spread rather than assigned, so an unverified property has no key at all.
    // exactOptionalPropertyTypes makes absent and explicitly-undefined different, and
    // the fixture round trip would notice.
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
      // Already ordered by ordinal, which is what turns rows back into an array.
      const matching = rows.filter((row) => row.property_name === definition.name);

      if (definition.cardinality === 'MULTIPLE') {
        assembled[definition.name] = matching.map(toTracked);
        continue;
      }

      const single = matching[0];
      if (single !== undefined) assembled[definition.name] = toTracked(single);
    }

    // Validated on the way out for the same reason as on the way in: with EAV storage,
    // nothing else establishes that these rows form a well-typed object.
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
    const maxDepth = resolveMaxDepth(query.maxDepth);

    if (query.via.length === 0) {
      throw new RangeError('traverse requires at least one link type in `via`');
    }

    const stored = await objectTypeOf(query.from.id);
    if (stored === undefined || stored !== query.from.objectType) {
      throw new UnknownObjectError(query.from.objectType, query.from.id);
    }

    const { rows } = await db.query<TraversalRow>(TRAVERSE, [
      query.from.id,
      [...query.via],
      maxDepth,
      query.to,
    ]);

    const row = rows[0];
    if (row === undefined) throw new Error('traversal returned no row');

    const source: PathNode = { id: query.from.id, objectType: query.from.objectType };
    const rawPaths = Array.isArray(row.paths) ? row.paths : [];
    const paths = rawPaths.map((steps) => makePath(source, asPathSteps(steps)));

    return { targets: collapseToTargets(paths), truncated: row.truncated, maxDepth };
  }

  return { getObject, getLinks, traverse };
}
