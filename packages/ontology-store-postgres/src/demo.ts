/**
 * Week 1 demo: a supplier-risk traversal with a real weakest link, an agent-proposed
 * Action that is blocked, a human approval, and the audit trail that recorded it.
 */
import {
  AgentExecutionBlockedError,
  SUPPLIER_DEVICE_RISK,
  weakestLink,
  type PathStep,
} from '@sourcing/ontology';
import { Pool } from 'pg';

import { createPostgresContext } from './context.js';
import { requireDatabaseUrl } from './env.js';
import { approveAction, executeProposedAs, objectAuditHistory, proposeAction } from './governance.js';
import {
  DEMO_HELIX_DEVICE,
  DEMO_SUPPLIER_ACTION,
  DEMO_SUPPLIER_RISK,
} from './seed-data.js';

function hop(step: PathStep): string {
  const arrow = step.direction === 'ALONG' ? '-->' : '<--';
  return `${arrow}[${step.linkType} ${step.confidence.toFixed(2)}]--> ${step.to.id}`;
}

const pool = new Pool({ connectionString: requireDatabaseUrl() });

try {
  const ctx = createPostgresContext(pool);

  const helix = await ctx.getObject('SUPPLIER', DEMO_SUPPLIER_RISK);
  if (helix === undefined) {
    throw new Error('seed has not been loaded. Run `pnpm db:seed` first.');
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
  if (affectedIds.length !== 1 || affectedIds[0] !== DEMO_HELIX_DEVICE) {
    console.log(
      `ERROR: expected exactly ${DEMO_HELIX_DEVICE}, got: ${affectedIds.join(', ') || '(none)'}`,
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

  const medsource = await ctx.getObject('SUPPLIER', DEMO_SUPPLIER_ACTION);
  if (medsource === undefined) throw new Error(`missing ${DEMO_SUPPLIER_ACTION}`);

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
