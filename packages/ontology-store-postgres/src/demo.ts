/**
 * Week 1 demo: supplier-risk traversal, agent propose / human approve on ingested data.
 * Requires `pnpm db:seed` (Week 2 CSV ingest, not the old seed graph).
 */
import {
  AgentExecutionBlockedError,
  SAP_DEVICE_MASTER,
  SAP_VENDOR_MASTER,
  SUPPLIER_DEVICE_RISK,
  weakestLink,
  type PathStep,
} from '@sourcing/ontology';
import { Pool } from 'pg';

import { createPostgresContext } from './context.js';
import { requireDatabaseUrl } from './env.js';
import { approveAction, executeProposedAs, objectAuditHistory, proposeAction } from './governance.js';
import { ingestObjectId } from './ingest/object-id.js';
import { loadWeek2Manifest } from './ingest/run-week2-ingest.js';

function hop(step: PathStep): string {
  const arrow = step.direction === 'ALONG' ? '-->' : '<--';
  return `${arrow}[${step.linkType} ${step.confidence.toFixed(2)}]--> ${step.to.id}`;
}

const pool = new Pool({ connectionString: requireDatabaseUrl() });

try {
  const manifest = await loadWeek2Manifest();
  const roles = manifest.demoRoles;
  const helixId = ingestObjectId(SAP_VENDOR_MASTER, roles.helixSurvivorSourceKey);
  const medSourceId = ingestObjectId(SAP_VENDOR_MASTER, roles.medSourceSurvivorSourceKey);
  const helixDeviceId = ingestObjectId(SAP_DEVICE_MASTER, roles.helixOnlyDeviceSourceKey);

  const ctx = createPostgresContext(pool);

  const helix = await ctx.getObject('SUPPLIER', helixId);
  if (helix === undefined) {
    throw new Error('demo graph not loaded. Run `pnpm db:seed` (Week 2 ingest) first.');
  }

  console.log(`=== Supplier risk: ${helix.legalName.value} (${helix.id}) ===`);
  console.log(
    `legalName confidence ${helix.legalName.confidence.toFixed(2)}  status ${helix.status.value}`,
  );

  const result = await ctx.traverse({
    from: { objectType: 'SUPPLIER', id: helix.id },
    profile: SUPPLIER_DEVICE_RISK,
  });

  const affectedIds = result.targets.map((entry) => entry.target.id).sort();
  if (affectedIds.length !== 1 || affectedIds[0] !== helixDeviceId) {
    console.log(
      `ERROR: expected exactly ${helixDeviceId}, got: ${affectedIds.join(', ') || '(none)'}`,
    );
    process.exitCode = 1;
  }

  console.log(`affected devices: ${String(result.targets.length)}`);

  for (const target of result.targets) {
    const device = await ctx.getObject('DEVICE', target.target.id);
    const label = device?.deviceName.value ?? target.target.id;
    const weakest = weakestLink(target.bestPath);
    const hops = target.bestPath.steps.map(hop).join(' ');
    console.log(
      `\n  ${label}  confidence ${target.confidence.toFixed(2)}  routes ${String(target.pathCount)}`,
    );
    console.log(`    ${helix.id} ${hops}`);
    if (weakest !== null) {
      console.log(
        `    weakest: ${weakest.linkType} @ ${weakest.confidence.toFixed(2)}  (the fact to go verify)`,
      );
    }
  }

  const medsource = await ctx.getObject('SUPPLIER', medSourceId);
  if (medsource === undefined) {
    throw new Error(`missing MedSource survivor ${roles.medSourceSurvivorSourceKey}`);
  }

  console.log(`\n=== Agent proposes approveSupplierChange on ${medsource.legalName.value} ===`);
  console.log(`current status: ${medsource.status.value}`);

  const proposed = await proposeAction(pool, {
    actionName: 'approveSupplierChange',
    input: {
      supplierId: medsource.id,
      toStatus: 'APPROVED',
      justification: 'ISO 13485 current; no open CRITICAL events',
    },
    actor: { id: 'agent-risk-1', type: 'AGENT' },
    justification: 'ISO 13485 current; no open CRITICAL events',
  });
  console.log(`proposed audit ${proposed.id}  status=${proposed.status}`);

  try {
    await executeProposedAs(pool, proposed.id, { id: 'agent-risk-1', type: 'AGENT' });
    console.log('ERROR: agent execution was not blocked');
    process.exitCode = 1;
  } catch (error) {
    if (error instanceof AgentExecutionBlockedError) {
      console.log(`blocked: ${error.message}`);
    } else {
      throw error;
    }
  }

  const still = await ctx.getObject('SUPPLIER', medsource.id);
  console.log(`status after blocked execute: ${still?.status.value ?? '?'}`);

  console.log(`\n=== Human approves ===`);
  const executed = await approveAction(pool, {
    auditId: proposed.id,
    approver: { id: 'k.novak', type: 'HUMAN' },
    justification: 'reviewed certs and CAPA board; approve',
  });
  console.log(`audit ${executed.id}  status=${executed.status}  approver=${executed.approvedBy ?? '?'}`);

  const after = await ctx.getObject('SUPPLIER', medsource.id);
  console.log(`status: ${medsource.status.value} -> ${after?.status.value ?? '?'}`);

  console.log(`\n=== Audit trail for ${medsource.id} ===`);
  const trail = await objectAuditHistory(pool, medsource.id);
  for (const record of trail) {
    const approval =
      record.approvedBy === undefined ? '' : `  approved by ${record.approvedBy}`;
    console.log(
      `  ${record.proposedAt}  ${record.actionName}  ${record.actorType}:${record.actor}  ${record.status}${approval}`,
    );
  }
} finally {
  await pool.end();
}
