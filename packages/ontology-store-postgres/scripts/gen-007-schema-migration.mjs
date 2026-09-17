import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { linkTypeDefinitions, objectTypeDefinitions } from '../../ontology/dist/index.js';

const ot = JSON.stringify(objectTypeDefinitions);
const lt = JSON.stringify(linkTypeDefinitions);

const sql = `-- 007_schema_version_0_2_0.sql
--
-- SUPPLIER gains aliases and mergedFrom for entity resolution (006).
-- Payload regenerated from objectTypeDefinitions / linkTypeDefinitions; do not hand-edit.

INSERT INTO schema_versions (version, object_types, link_types, applied_via)
VALUES (
    '0.2.0',
    $object_types$${ot}$object_types$::jsonb,
    $link_types$${lt}$link_types$::jsonb,
    'MIGRATION'
);
`;

const out = fileURLToPath(
  new URL('../migrations/007_schema_version_0_2_0.sql', import.meta.url),
);
writeFileSync(out, sql);
console.log(`wrote ${out}`);
