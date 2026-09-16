import type { PathStepSpec, TraversalProfile } from '@sourcing/ontology';

/**
 * Builds a fixed join chain for `profile.pattern`: one join per step, no recursion.
 * Parameter `$1` is the traversal source object id.
 */
export function buildPatternTraverseSql(profile: TraversalProfile): string {
  if (profile.pattern.length === 0) {
    throw new RangeError('traverse requires a non-empty profile pattern');
  }

  const joins: string[] = [];
  const stepJson: string[] = [];

  for (const [index, step] of profile.pattern.entries()) {
    const link = `l${String(index)}`;
    const node = `n${String(index)}`;

    if (index === 0) {
      if (step.direction === 'ALONG') {
        joins.push(
          `JOIN links ${link} ON ${link}.link_type = '${step.linkType}' AND ${link}.from_id = source.id`,
        );
        joins.push(`JOIN objects ${node} ON ${node}.id = ${link}.to_id`);
      } else {
        joins.push(
          `JOIN links ${link} ON ${link}.link_type = '${step.linkType}' AND ${link}.to_id = source.id`,
        );
        joins.push(`JOIN objects ${node} ON ${node}.id = ${link}.from_id`);
      }
    } else {
      const prev = `n${String(index - 1)}`;
      if (step.direction === 'ALONG') {
        joins.push(
          `JOIN links ${link} ON ${link}.link_type = '${step.linkType}' AND ${link}.from_id = ${prev}.id`,
        );
        joins.push(`JOIN objects ${node} ON ${node}.id = ${link}.to_id`);
      } else {
        joins.push(
          `JOIN links ${link} ON ${link}.link_type = '${step.linkType}' AND ${link}.to_id = ${prev}.id`,
        );
        joins.push(`JOIN objects ${node} ON ${node}.id = ${link}.from_id`);
      }
    }

    stepJson.push(stepObjectJson(link, node, step));
  }

  const terminal = `n${String(profile.pattern.length - 1)}`;
  const sortKey = `${terminal}.id`;

  return `
SELECT COALESCE(
  jsonb_agg(path_steps ORDER BY sort_key),
  '[]'::jsonb
) AS paths
  FROM (
    SELECT jsonb_build_array(${stepJson.join(', ')}) AS path_steps,
           ${sortKey} AS sort_key
      FROM objects source
      ${joins.join('\n      ')}
     WHERE source.id = $1::text
       AND ${terminal}.object_type = '${profile.to}'
       AND ${terminal}.id <> source.id
  ) paths
`;
}

function stepObjectJson(linkAlias: string, nodeAlias: string, step: PathStepSpec): string {
  return `jsonb_build_object(
    'linkId', ${linkAlias}.id::text,
    'linkType', ${linkAlias}.link_type,
    'direction', '${step.direction}',
    'confidence', ${linkAlias}.confidence::float8,
    'to', jsonb_build_object('id', ${nodeAlias}.id, 'objectType', ${nodeAlias}.object_type)
  )`;
}
