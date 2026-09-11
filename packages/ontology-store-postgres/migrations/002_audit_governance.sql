-- 002_audit_governance.sql
--
-- Two things 001 could not express:
--
--   1. Which objects an audit record touched. ONTOLOGY.md §5 gives AuditRecord no
--      object reference, only opaque before/after payloads, but §8 requires audit
--      history to be queryable for any object. ActionDefinition.execute returns
--      ObjectMutation[], so one action may mutate several objects and a single
--      object_id column would be wrong as soon as that happens.
--
--   2. That an agent-proposed action cannot reach EXECUTED without a human approver.
--      This is the strongest claim the platform makes, so it is structural here rather
--      than a convention at the API boundary.


-- ---------------------------------------------------------------------------
-- audit_record_objects — which objects a record touched
-- ---------------------------------------------------------------------------

CREATE TABLE audit_record_objects (
    audit_record_id uuid NOT NULL REFERENCES audit_records (id) ON DELETE RESTRICT,
    object_id       text NOT NULL REFERENCES objects (id)       ON DELETE RESTRICT,

    CONSTRAINT audit_record_objects_pkey PRIMARY KEY (audit_record_id, object_id)
);

-- "Every audit record that touched this object." The primary key leads with
-- audit_record_id and so serves the forward direction only; object-scoped audit history
-- is the direction humans actually ask for.
CREATE INDEX audit_record_objects_object_idx
    ON audit_record_objects (object_id);

-- Note the deliberate limitation: before_state and after_state stay whole-action
-- payloads on audit_records. For an action that mutates several objects you can find
-- every record that touched a given object, but working out which slice of the payload
-- applied to which object means reading the jsonb. Per-object before/after is a bigger
-- change to ONTOLOGY.md §5 and is not needed by either Week 1 Action.
--
-- "Every audit record addresses at least one object" needs a trigger or a deferred
-- constraint to enforce here, so it is asserted by the CI conformance check instead.


-- ---------------------------------------------------------------------------
-- Agents may propose. Agents may never execute.
-- ---------------------------------------------------------------------------

-- An agent-proposed action that auto-executes with no human involved was executed by
-- the agent in the only sense a regulator cares about. "The agent proposed it, the
-- system executed it" dissolves the guarantee into a technicality, so the database
-- refuses the row.
--
-- CONSEQUENCE, and it must not be rediscovered by reading this constraint:
-- ActionDefinition.approvalPolicy governs HUMAN-INITIATED actions only. For
-- actorType 'AGENT' it is advisory at most. Nobody reading an approvalPolicy that
-- returns 'AUTO' should be able to conclude that it applies to agents.
ALTER TABLE audit_records
    ADD CONSTRAINT audit_records_agent_execution_needs_human_approval
    CHECK (NOT (actor_type = 'AGENT' AND status = 'EXECUTED' AND approved_by IS NULL));

-- An APPROVED record with nobody accountable for the approval is incoherent regardless
-- of actor. 001 already forbids an approver on a PROPOSED or REJECTED record; this
-- closes the other direction.
--
-- EXECUTED deliberately stays permitted without an approver, because that is exactly
-- the shape of a human-initiated action whose approvalPolicy returned 'AUTO'.
ALTER TABLE audit_records
    ADD CONSTRAINT audit_records_approved_needs_approver
    CHECK (status <> 'APPROVED' OR approved_by IS NOT NULL);
