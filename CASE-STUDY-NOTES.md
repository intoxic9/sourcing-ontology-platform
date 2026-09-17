# Case study notes

Running notes on decisions, failures, and what I learned building this. Written as I go,
not reconstructed afterwards. Rough by design.

---

## Week 1 — The bug my test suite could not see

By the end of Week 1 the system had 106 tests, a differential conformance check running
12 traversal queries through two independent implementations (an in-memory walk and a
recursive CTE in Postgres), and green gates on build, lint, typecheck and a database
boundary check.

Then I traced one path by hand and found the traversal was answering the wrong question.

### What the system reported

Querying "which devices are at risk if Helix Polymers fails?" returned five devices. One
of them, VitalMon 12, came back at 0.48 confidence via this path:

```
SUP-HELIX →SUPPLIES→ PART-01 ←SUPPLIES← SUP-MEDSOURCE →SUPPLIES→ PART-20 ←COMPOSED_OF← DEV-MON12
```

Read it slowly. The walk enters PART-01 from Helix, then exits PART-01 *backwards* along
another SUPPLIES edge into a completely different supplier, and continues from there.

The claim "if Helix fails, VitalMon is at risk" is false. VitalMon's dependency in that
chain is on MedSource, not Helix.

Worse, the meaning is inverted. "Helix and MedSource both supply PART-01" is a
second-source relationship. It means the Infusor is *more* resilient to a Helix failure,
not less. The system was reading a redundancy signal as a risk-propagation path.

Four of the five results were structurally invalid. Only one was a real answer.

### Why every test passed

I had modelled traversal as "any simple path whose edge types are drawn from an
allowlist, up to a depth cap." That finds graph *reachability*. Supply chain risk is not
reachability.

The conformance check compared the in-memory walk against the SQL implementation and
found them identical across all 12 queries, including truncation flags and path counts.
Both were correct implementations. They were correct implementations of the wrong
question, so agreeing with each other proved nothing about whether either was right.

This is the part worth remembering: **cross-implementation agreement validates
consistency, not correctness.** Two engines built from one flawed specification will
agree perfectly all the way to a wrong answer.

The only place the real seed data was exercised was the demo script, and nothing
asserted its output.

### The fix

The constraint was never depth. A supplier-risk query has a fixed *shape*:

| Step | Link type | Direction | Meaning |
|---|---|---|---|
| 1 | `SUPPLIES` | along | this supplier supplies this part |
| 2 | `COMPOSED_OF` | against | this part is in this device's BOM |

Two steps. That is the whole question. Anything longer is a different question.

So `via` (an edge-type allowlist) and `maxDepth` were deleted and replaced with
`TraversalProfile { pattern, to }` — an explicit sequence of typed, directed steps paired
with its terminal object type, so a query cannot ask for a target that contradicts the
pattern's endpoint.

A bounded pattern also removed the need for recursion entirely. The recursive CTE, cycle
detection, depth capping and the `truncated` flag all got deleted. A two-step pattern is
two SQL joins.

### Two attempts to fix the wrong thing

The first attempt at a regression test edited the fixture to remove the link that made
the bug possible. A regression test that passes because the failing condition was deleted
from the fixture cannot catch the regression.

The second attempt added a filter: drop a device from a supplier's results if another
supplier who shares the entry part also supplies a different part on the same device.
That happened to make both known cases pass. It also suppresses genuine risk — if Helix
supplies tubing in the VitalMon and MedSource supplies both that tubing and the display
module, a Helix failure still stops VitalMon production. The rule hides a real
dependency. In a medical device supply chain, a false negative is the worst available
error class.

The tell was the shape of the work: three successive refinements of a rule, including a
bug fix *inside* the rule, with no principle underneath it. That is curve-fitting to the
known cases, not a semantics.

The two-step grammar was already the principle. The fixture's expectation was wrong, not
the code.

### What the fixture became

```
part-shared    supplied by sup-helix AND sup-other, composed into dev-infusor only
part-bridge    supplied by sup-other only, composed into dev-bridge-only
dev-bridge-only contains no part that sup-helix supplies
```

Assertion: `SUPPLIER_DEVICE_RISK` from `sup-helix` returns `dev-infusor` and NOT
`dev-bridge-only`. The old unbounded walk returned both. That contrast is the regression,
and the grammar alone produces it — no filter needed.

The same fixture queried from `sup-other` returns both devices, which proves the pattern
is not simply suppressing results.

### What I changed about how I work

Added to the project rules:

> If a test fails, first establish whether the test or the code is wrong. Never change a
> fixture or add a filter to make a failing assertion pass without stating which one was
> incorrect and why.

And the habit that actually caught this: after a unit lands, trace one result by hand in
`psql` against the raw rows. Not through the API, not through the repository layer —
straight SQL against the tables. Tests written alongside an implementation share its
assumptions. The database does not.

---

## Decisions I would defend in a review

**EAV storage over typed tables.** The adaptive layer is meant to propose schema changes
when it detects drift in source data. With typed tables that proposal is a DDL migration,
authored by an agent, run against production. In a regulated environment that is not
shippable. With EAV it is a row in `schema_versions` and rows in `object_properties`. The
cost is losing database-level type constraints, so Zod at the repository boundary becomes
the only guarantee — which is why nothing outside the store package may hold a database
credential, enforced by a CI check that fails the build.

**Minimum confidence along a path, never the product.** Five hops multiplied out gives
0.08, a number nobody can act on. The minimum names the single weakest fact in the chain,
which is the thing a human should go verify. The output is shaped around what someone
does next.

Empty path confidence is 1.0, and that is forced rather than chosen: path confidence must
compose, so `conf(p1 ++ p2) = min(conf(p1), conf(p2))`. If the empty path were anything
below 1.0, prepending it would weaken a real path.

**Absence is not zero confidence.** "A chain exists and the evidence for it is worthless"
and "no chain was found" are different claims. Only the first is a number.

**Agents may propose Actions but never execute them, enforced in the database.** An
agent-proposed action always requires human approval regardless of what the approval
policy returns, and a CHECK constraint enforces it alongside the application check. There
was a tempting alternative framing — the agent isn't the executor, the system is — but if
an agent proposes something that auto-executes with no human involved, the agent executed
it in the only sense a regulator cares about.

**Where that guarantee stops.** `approver_type` records what the caller *claims* the
approver is. It turns a silent absence into a discoverable lie; it is not proof. A real
actors table with foreign keys is what would make it unforgeable. That is documented as a
known boundary rather than left as an implied stronger claim.
