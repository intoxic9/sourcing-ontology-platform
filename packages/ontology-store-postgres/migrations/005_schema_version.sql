-- 005_schema_version.sql
--
-- The single schema_versions row, held back from 001 on purpose. Its payload is the
-- ObjectTypeDefinition and LinkTypeDefinition data that @sourcing/ontology derives from
-- the Zod schemas, so writing it before those definitions existed would have made the
-- SQL the source of truth and the TypeScript a copy. Until now objects.schema_version
-- had nothing to reference and no object could be inserted, which was the intended gate.
--
-- The payload is a literal rather than something a script generates at migration time.
-- A migration that computes its own contents is not reviewable: what a reader approves
-- and what runs are then two different things. The cost is that this literal can drift
-- from the code, so the conformance check asserts that the stored row still equals what
-- @sourcing/ontology produces, and fails if schema_versions is empty. "Not yet written"
-- and "never written" must not look the same. See PLAN.md §6.2.
--
-- Regenerate the payload from objectTypeDefinitions and linkTypeDefinitions; do not
-- hand-edit it. Later schema changes append a new row rather than updating this one —
-- schema_versions is history, and objects point at the version they were written under.

INSERT INTO schema_versions (version, object_types, link_types, applied_via)
VALUES (
    '0.1.0',

    -- Property order matches the Zod schema declaration order. `required` is always
    -- true for MULTIPLE, which is present-and-empty rather than absent, and `id` is
    -- absent throughout because it lives in objects.id, not in object_properties.
    $object_types$[
  {
    "name": "SUPPLIER",
    "properties": [
      {"name":"legalName","valueType":"STRING","cardinality":"SINGLE","required":true,"mutability":"INGESTION"},
      {"name":"duns","valueType":"STRING","cardinality":"SINGLE","required":false,"mutability":"INGESTION"},
      {"name":"country","valueType":"STRING","cardinality":"SINGLE","required":true,"mutability":"INGESTION"},
      {"name":"tier","valueType":"STRING","cardinality":"SINGLE","required":true,"mutability":"INGESTION","enumValues":["TIER_1","TIER_2","TIER_3"]},
      {"name":"status","valueType":"STRING","cardinality":"SINGLE","required":true,"mutability":"ACTION_ONLY","enumValues":["APPROVED","PROVISIONAL","SUSPENDED","DISQUALIFIED"]},
      {"name":"qualityRating","valueType":"NUMBER","cardinality":"SINGLE","required":true,"mutability":"INGESTION"},
      {"name":"certifications","valueType":"STRING","cardinality":"MULTIPLE","required":true,"mutability":"INGESTION"}
    ]
  },
  {
    "name": "PART",
    "properties": [
      {"name":"partNumber","valueType":"STRING","cardinality":"SINGLE","required":true,"mutability":"INGESTION"},
      {"name":"description","valueType":"STRING","cardinality":"SINGLE","required":true,"mutability":"INGESTION"},
      {"name":"classification","valueType":"STRING","cardinality":"SINGLE","required":true,"mutability":"INGESTION","enumValues":["DIRECT_MATERIAL","COMPONENT","SUBASSEMBLY"]},
      {"name":"criticality","valueType":"STRING","cardinality":"SINGLE","required":true,"mutability":"INGESTION","enumValues":["CRITICAL","MAJOR","MINOR"]},
      {"name":"requiresRequalification","valueType":"BOOLEAN","cardinality":"SINGLE","required":true,"mutability":"ACTION_ONLY"},
      {"name":"unitCost","valueType":"NUMBER","cardinality":"SINGLE","required":true,"mutability":"INGESTION"}
    ]
  },
  {
    "name": "DEVICE",
    "properties": [
      {"name":"deviceName","valueType":"STRING","cardinality":"SINGLE","required":true,"mutability":"INGESTION"},
      {"name":"productFamily","valueType":"STRING","cardinality":"SINGLE","required":true,"mutability":"INGESTION"},
      {"name":"regulatoryClass","valueType":"STRING","cardinality":"SINGLE","required":true,"mutability":"INGESTION","enumValues":["CLASS_I","CLASS_II","CLASS_III"]},
      {"name":"lifecycleStage","valueType":"STRING","cardinality":"SINGLE","required":true,"mutability":"INGESTION","enumValues":["DEVELOPMENT","ACTIVE","END_OF_LIFE","DISCONTINUED"]}
    ]
  },
  {
    "name": "SITE",
    "properties": [
      {"name":"siteName","valueType":"STRING","cardinality":"SINGLE","required":true,"mutability":"INGESTION"},
      {"name":"country","valueType":"STRING","cardinality":"SINGLE","required":true,"mutability":"INGESTION"},
      {"name":"siteType","valueType":"STRING","cardinality":"SINGLE","required":true,"mutability":"INGESTION","enumValues":["MANUFACTURING","ASSEMBLY","STERILIZATION","DISTRIBUTION"]}
    ]
  },
  {
    "name": "QUALITY_EVENT",
    "properties": [
      {"name":"eventType","valueType":"STRING","cardinality":"SINGLE","required":true,"mutability":"INGESTION","enumValues":["AUDIT_FINDING","NONCONFORMANCE","COMPLAINT","RECALL"]},
      {"name":"severity","valueType":"STRING","cardinality":"SINGLE","required":true,"mutability":"INGESTION","enumValues":["CRITICAL","MAJOR","MINOR"]},
      {"name":"openedAt","valueType":"TIMESTAMP","cardinality":"SINGLE","required":true,"mutability":"INGESTION"},
      {"name":"closedAt","valueType":"TIMESTAMP","cardinality":"SINGLE","required":false,"mutability":"INGESTION"},
      {"name":"description","valueType":"STRING","cardinality":"SINGLE","required":true,"mutability":"INGESTION"}
    ]
  }
]$object_types$::jsonb,

    -- AFFECTS_SUPPLIER's MANY_TO_ONE is enforced by links_affects_supplier_single_target_idx
    -- in 004. Recorded here as the declared intent; the index is what makes it true.
    $link_types$[
  {"name":"SUPPLIES","from":"SUPPLIER","to":"PART","cardinality":"MANY_TO_MANY"},
  {"name":"COMPOSED_OF","from":"DEVICE","to":"PART","cardinality":"MANY_TO_MANY"},
  {"name":"MANUFACTURED_AT","from":"DEVICE","to":"SITE","cardinality":"MANY_TO_MANY"},
  {"name":"AFFECTS_SUPPLIER","from":"QUALITY_EVENT","to":"SUPPLIER","cardinality":"MANY_TO_ONE"},
  {"name":"AFFECTS_PART","from":"QUALITY_EVENT","to":"PART","cardinality":"MANY_TO_MANY"}
]$link_types$::jsonb,

    -- Not an agent proposal, so audit_record_id stays NULL and
    -- schema_versions_agent_change_is_audited is satisfied.
    'MIGRATION'
);
