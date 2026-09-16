import {
  UnknownObjectError,
  type LinkQuery,
  type ObjectOf,
  type OntologyContext,
} from './context.js';
import type { Link } from './link-types.js';
import type { ObjectTypeName } from './object-types.js';
import {
  collapseToTargets,
  makePath,
  resolveMaxDepth,
  type Path,
  type PathNode,
  type PathStep,
  type StepDirection,
  type TraversalQuery,
  type TraversalResult,
} from './traversal.js';

/** Discriminated so the object type and its payload cannot be paired up wrongly. */
export type InMemoryObject = {
  [T in ObjectTypeName]: { objectType: T; data: ObjectOf<T> };
}[ObjectTypeName];

export type InMemoryGraph = {
  objects: readonly InMemoryObject[];
  links: readonly Link[];
};

type Edge = {
  link: Link;
  direction: StepDirection;
  otherId: string;
};

/**
 * Runs a synchronous body but reports failure as a rejection.
 *
 * A method typed `Promise<T>` that throws synchronously is a trap: a caller writing
 * `ctx.traverse(q).catch(...)` never sees the error, because the throw happens before
 * a promise exists. The Postgres implementation gets this for free by being genuinely
 * async; this one has to be deliberate about it.
 */
function deferred<T>(compute: () => T): Promise<T> {
  try {
    return Promise.resolve(compute());
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * An `OntologyContext` over a fixture graph, so the Action layer and the path algebra
 * can be tested with no Postgres running — the reason the core's dependency budget is
 * zod and nothing else (PLAN.md §4).
 *
 * Built on the same `makePath` and `collapseToTargets` the rest of the core uses, so it
 * is a reference implementation rather than a second one. The recursive CTE in the store
 * package is where a genuine disagreement could hide, and the conformance check over
 * seeded data is where the two get compared.
 *
 * The walk enumerates simple paths, which is exponential in a dense graph. Acceptable
 * for fixtures bounded by `maxDepth`; Postgres does the real one.
 */
export function createInMemoryContext(graph: InMemoryGraph): OntologyContext {
  const objects = new Map<string, InMemoryObject>();
  for (const object of graph.objects) {
    objects.set(object.data.id, object);
  }

  const adjacency = new Map<string, Edge[]>();
  const connect = (from: string, edge: Edge): void => {
    const edges = adjacency.get(from);
    if (edges === undefined) adjacency.set(from, [edge]);
    else edges.push(edge);
  };

  for (const link of graph.links) {
    // Both directions, because reaching a Device from a Part means crossing
    // COMPOSED_OF against its declared direction.
    connect(link.fromId, { link, direction: 'ALONG', otherId: link.toId });
    connect(link.toId, { link, direction: 'AGAINST', otherId: link.fromId });
  }

  const nodeOf = (id: string): PathNode => {
    const record = objects.get(id);
    if (record === undefined) {
      // Postgres has foreign keys for this; a fixture does not, and a link into
      // nowhere would otherwise surface as a silently missing path.
      throw new Error(`in-memory graph has a link to unknown object ${id}`);
    }
    return { id, objectType: record.objectType };
  };

  function traverse(query: TraversalQuery): TraversalResult {
    const maxDepth = resolveMaxDepth(query.maxDepth);

    if (query.via.length === 0) {
      // Returning "nothing is at risk" for a query that can cross no edges is the most
      // dangerous possible answer to get silently wrong.
      throw new RangeError('traverse requires at least one link type in `via`');
    }

    const record = objects.get(query.from.id);
    if (record === undefined || record.objectType !== query.from.objectType) {
      throw new UnknownObjectError(query.from.objectType, query.from.id);
    }

    const source: PathNode = { id: query.from.id, objectType: query.from.objectType };
    const via = new Set(query.via);

    const found: Path[] = [];
    const steps: PathStep[] = [];
    // Seeded with the source, which both detects cycles and is what keeps the source
    // out of its own results — "supplier S affects supplier S" needs no special case.
    const onPath = new Set<string>([source.id]);
    let truncated = false;

    const walk = (nodeId: string): void => {
      const continuations = (adjacency.get(nodeId) ?? []).filter(
        (edge) => via.has(edge.link.linkType) && !onPath.has(edge.otherId),
      );

      if (steps.length >= maxDepth) {
        // Stopping with somewhere left to go is exactly what `truncated` reports.
        if (continuations.length > 0) truncated = true;
        return;
      }

      for (const edge of continuations) {
        const to = nodeOf(edge.otherId);

        steps.push({
          linkId: edge.link.id,
          linkType: edge.link.linkType,
          direction: edge.direction,
          confidence: edge.link.confidence,
          to,
        });
        onPath.add(to.id);

        if (to.objectType === query.to) found.push(makePath(source, [...steps]));

        // Keep going past a match: a device can lead onward to a site.
        walk(to.id);

        onPath.delete(to.id);
        steps.pop();
      }
    };

    walk(source.id);

    return { targets: collapseToTargets(found), truncated, maxDepth };
  }

  return {
    getObject: <T extends ObjectTypeName>(objectType: T, id: string) =>
      deferred<ObjectOf<T> | undefined>(() => {
        const record = objects.get(id);
        if (record === undefined) return undefined;
        if (record.objectType !== objectType) throw new UnknownObjectError(objectType, id);

        // The runtime check above establishes this, but TypeScript cannot narrow a
        // union to a generic parameter through a comparison.
        return record.data as ObjectOf<T>;
      }),

    getLinks: (query: LinkQuery) =>
      deferred(() =>
        graph.links.filter(
          (link) =>
            (link.fromId === query.objectId || link.toId === query.objectId) &&
            (query.linkType === undefined || link.linkType === query.linkType),
        ),
      ),

    traverse: (query: TraversalQuery) => deferred(() => traverse(query)),
  };
}
