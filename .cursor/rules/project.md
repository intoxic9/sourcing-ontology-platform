---
alwaysApply: true
---

# Project context

Building a governed ontology platform for medical device sourcing.
Read ONTOLOGY.md in the repo root — it is the design contract.

Domain: suppliers, parts, devices, sites, contracts, quality events.
Goal: answer "which devices are at risk if this supplier fails?"
with an auditable path and a confidence assessment.

# Non-negotiables

- TypeScript strict mode. No `any`.
- Every ontology property is Tracked<T> carrying confidence and provenance.
- Path confidence is the MINIMUM along the path, never the product.
- AI agents may PROPOSE Actions. They may never EXECUTE them.
- Every mutation writes an immutable AuditRecord.
- Reads are free. Writes are governed through Actions.

# How to work with me

- Propose the design in plain terms BEFORE writing code. Wait for my go-ahead.
- Tell me where I am overbuilding. I would rather cut than ship something brittle.
- Work in small units. One concern per response.
- If a requirement is ambiguous, ask instead of guessing.
- Explain non-obvious decisions in comments.