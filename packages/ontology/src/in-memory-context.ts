import {
  UnknownObjectError,
  type LinkQuery,
  type ObjectOf,
  type OntologyContext,
} from './context.js';
import type { Link } from './link-types.js';
import type { ObjectTypeName } from './object-types.js';
import { enumeratePatternPaths } from './pattern-walk.js';
import {
  collapseToTargets,
  type PathNode,
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
 * is a reference implementation rather than a second one. The pattern-shaped SQL in the
 * store package is where a genuine disagreement could hide, and the conformance check
 * runs the same fixture through both.
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
    connect(link.fromId, { link, direction: 'ALONG', otherId: link.toId });
    connect(link.toId, { link, direction: 'AGAINST', otherId: link.fromId });
  }

  const walkGraph = {
    objectTypeOf(id: string): ObjectTypeName | undefined {
      return objects.get(id)?.objectType;
    },
    edgesFrom(nodeId: string): readonly Edge[] {
      return adjacency.get(nodeId) ?? [];
    },
  };

  function traverse(query: TraversalQuery): TraversalResult {
    const record = objects.get(query.from.id);
    if (record === undefined || record.objectType !== query.from.objectType) {
      throw new UnknownObjectError(query.from.objectType, query.from.id);
    }

    const source: PathNode = { id: query.from.id, objectType: query.from.objectType };
    const paths = enumeratePatternPaths(source, query.profile, walkGraph);

    return { targets: collapseToTargets(paths), profile: query.profile };
  }

  return {
    getObject: <T extends ObjectTypeName>(objectType: T, id: string) =>
      deferred<ObjectOf<T> | undefined>(() => {
        const record = objects.get(id);
        if (record === undefined) return undefined;
        if (record.objectType !== objectType) throw new UnknownObjectError(objectType, id);

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
