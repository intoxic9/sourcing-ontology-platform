-- 003_approver_identity.sql
--
-- Closes the hole 002 left open. The constraint added there checks that approved_by is
-- *present*, not that it belongs to a human, so an agent writing
-- approved_by = 'agent-2' satisfied it and reached EXECUTED with no human anywhere in
-- the chain. The database enforced "somebody approved", not "a human approved".
--
-- What this buys, stated precisely so nobody over-trusts it: approver_type turns an
-- implicit assumption into an explicit claim that lives inside the immutable audit
-- record. Reaching EXECUTED now requires the writer to assert, on the record, that a
-- human approved. That makes a false claim a discoverable lie rather than a silent
-- absence. It is not proof: the column records what the caller says the approver is.
-- Making it unforgeable needs identity to be a stored fact rather than a claim — an
-- actors table that both actor and approved_by reference. See PLAN.md §10.

ALTER TABLE audit_records
    ADD COLUMN approver_type text;

-- 'AGENT' is deliberately representable even though the constraint below rejects it at
-- approval time. If 'HUMAN' were the only storable value, the sole way to write the row
-- would be to claim a human approved, the rejection below could never fire, and the
-- data model would quietly encourage the lie. Recording what actually happened and
-- being refused is better than being forced into the compliant answer.
ALTER TABLE audit_records
    ADD CONSTRAINT audit_records_approver_type_known
    CHECK (approver_type IS NULL OR approver_type IN ('HUMAN', 'AGENT'));

-- An approver with no type, or a type with no approver, is half a fact.
ALTER TABLE audit_records
    ADD CONSTRAINT audit_records_approver_type_pair
    CHECK ((approved_by IS NULL) = (approver_type IS NULL));

-- The guarantee itself. Composes with 002: an AGENT actor cannot reach EXECUTED without
-- approved_by, and approved_by now cannot exist without a HUMAN approver_type.
ALTER TABLE audit_records
    ADD CONSTRAINT audit_records_approver_is_human
    CHECK (approved_by IS NULL OR approver_type = 'HUMAN');
