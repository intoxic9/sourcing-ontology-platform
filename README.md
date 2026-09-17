# Sourcing ontology platform

A governed semantic layer for medical device supply-chain data. Objects and links carry **provenance and confidence** on every fact; **reads** traverse the graph freely; **writes** go through Actions with validation, optional human approval, and an immutable audit trail. Agents may **propose** Actions but may **never execute** them.

The model covers five object types (`Supplier`, `Part`, `Device`, `Site`, `QualityEvent`), five link types, and two governed Actions backed by Postgres. Supplier→device risk uses a fixed two-hop profile and reports path confidence as the **minimum along the route** (weakest link), not a product. Schema and semantics live in [`ONTOLOGY.md`](ONTOLOGY.md); engineering choices in [`PLAN.md`](PLAN.md).

---

## Quick start

Requires **Node 24+**, **pnpm 12**, and **Docker** (Postgres 16).

```bash
docker compose up -d && pnpm install && pnpm demo
```

On first clone, copy [`.env.example`](.env.example) to `.env` so `DATABASE_URL` matches `docker-compose.yml` (the demo and store read it; only `@sourcing/ontology-store-postgres` may touch the database).

`pnpm demo` runs migrations, then **`pnpm db:seed`** (truncates and loads the **Week 2 SAP CSV ingest** — one graph, reproducible), then:

1. Traverses **supplier device risk** for Helix (`SUPPLIER_DEVICE_RISK`: `SUPPLIES` along, then `COMPOSED_OF` against).
2. Shows an agent **propose** `approveSupplierChange`, a **blocked** agent execute, and a **human approve** with audit history.

Other useful commands: `pnpm test`, `pnpm lint`, `pnpm conformance` (in-memory vs Postgres on shared fixtures). Regenerate dirty CSVs with `pnpm generate:week2`; reload DB with `pnpm db:seed` or `pnpm ingest:week2` (both reset the graph first).

---

## Demo output

```
=== Supplier risk: Helix Components International GmbH (…uuid…) ===
legalName confidence 0.66  status APPROVED
affected devices: 1

  Infusor IP-200  confidence 0.55  routes 1
    …uuid… -->[SUPPLIES 0.48]--> … -->[COMPOSED_OF 0.82]--> …
    weakest: SUPPLIES @ 0.48  (the fact to go verify)

=== Agent proposes approveSupplierChange on MedSource GmbH ===
current status: PROVISIONAL
proposed audit …  status=PROPOSED
blocked: agents may propose Actions; they may never execute them
status after blocked execute: PROVISIONAL

=== Human approves ===
audit …  status=EXECUTED  approver=k.novak
status: PROVISIONAL -> APPROVED

=== Audit trail for SUP-MEDSOURCE ===
  …  ingestSapWeek2  HUMAN:system-ingest  EXECUTED
  …  approveSupplierChange  AGENT:agent-risk-1  EXECUTED  approved by k.novak
```

(Audit IDs and timestamps change each run.)

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│  apps/api (Fastify) — HTTP, actor identity, routes writes   │
└────────────────────────────┬────────────────────────────────┘
                             │ uses OntologyContext
┌────────────────────────────▼────────────────────────────────┐
│  @sourcing/ontology-store-postgres                          │
│  EAV assembly, pattern-shaped SQL traversal, migrations,    │
│  seed, governance (propose / approve in transactions)       │
└────────────────────────────┬────────────────────────────────┘
                             │ implements
┌────────────────────────────▼────────────────────────────────┐
│  @sourcing/ontology (pure — Zod only)                         │
│  Tracked<T>, schemas, path algebra, ActionDefinitions,        │
│  TraversalProfile + OntologyContext port                      │
└───────────────────────────────────────────────────────────────┘
```

**Design contract.** [`ONTOLOGY.md`](ONTOLOGY.md) defines types, links, confidence rules, and the critical path:

`Supplier --SUPPLIES--> Part <--COMPOSED_OF-- Device --MANUFACTURED_AT--> Site`

**Implementation plan.** [`PLAN.md`](PLAN.md) records toolchain choices (Turborepo, hand-written SQL, no ORM), table layout, and governance invariants.

**Packages**

| Package | Role |
|--------|------|
| `@sourcing/ontology` | Pure core: validation, collapse/max-of-min path math, Actions, in-memory `OntologyContext` for tests. Declares the port; does not import Postgres. |
| `@sourcing/ontology-store-postgres` | Sole DB owner: migrations under `packages/ontology-store-postgres/migrations/`, repository writes, pattern join traversal, seed, demo, conformance dual-run. |
| `@sourcing/api` | HTTP surface: wires the core to the store and establishes actor identity on the way in. |

**Traversal.** Queries use a **`TraversalProfile`**: a fixed step list `{ pattern, to }` (e.g. `SUPPLIER_DEVICE_RISK` = two hops to `DEVICE`). The engine runs that pattern only—not unbounded graph search. Postgres expands the pattern into a fixed join chain; the core collapses paths to one best route per target with `pathCount`.

**Governance.** Mutations are `Action`s (`approveSupplierChange`, `flagPartForRequalification`) with preconditions, `PROPOSED` → human `EXECUTED` flow, and `audit_records` tied to affected objects. Schema is versioned in `schema_versions`; the emitted contract lives in [`contracts/ontology.schema.json`](contracts/ontology.schema.json).

**Repo layout.** `packages/*`, `apps/*`, `services/` (reserved for later Python workers that call the API, not the database). [`docker-compose.yml`](docker-compose.yml) runs only Postgres.

---

## Documentation map

| Document | Contents |
|----------|----------|
| [`CASE-STUDY-NOTES.md`](CASE-STUDY-NOTES.md) | Decision log and postmortems—especially the traversal semantics bug the conformance suite agreed on, and the move to pattern profiles |
| [`ONTOLOGY.md`](ONTOLOGY.md) | Schema design, `Tracked<T>`, link types, Actions, confidence semantics |
| [`PLAN.md`](PLAN.md) | Toolchain, storage layout, governance invariants, testing and conformance |
| [`contracts/ontology.schema.json`](contracts/ontology.schema.json) | JSON Schema emitted from Zod (cross-language contract) |
