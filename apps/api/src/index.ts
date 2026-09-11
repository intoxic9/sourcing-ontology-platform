/**
 * @sourcing/api — wires @sourcing/ontology to @sourcing/ontology-store-postgres and
 * exposes HTTP.
 *
 * This app owns actor identity, which makes it the enforcement point for
 * `actorType: 'HUMAN' | 'AGENT'` and for the rule that agents may propose Actions but
 * never execute them (PLAN.md §6.5).
 *
 * It depends on the store package but holds no database credentials of its own: no `pg`
 * import, no `DATABASE_URL` read. `pnpm check:db-boundary` fails the build if that ever
 * stops being true.
 *
 * Week 1 routes land here per PLAN.md §9: object reads, supplier → affected devices with
 * path and weakest link, Action propose/approve/reject, audit history, and the
 * low-confidence review queue.
 */
import Fastify, { type FastifyInstance } from 'fastify';

import { ONTOLOGY_SCHEMA_VERSION } from '@sourcing/ontology';

export interface ServerOptions {
  /** Off in tests, on everywhere else. */
  readonly logger?: boolean;
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });

  app.get('/health', () => ({
    status: 'ok',
    schemaVersion: ONTOLOGY_SCHEMA_VERSION,
  }));

  return app;
}
