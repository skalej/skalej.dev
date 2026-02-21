# Designing for Determinism in Async Processing Pipelines

**Post for:** RechnungRadar company page
**Links to:** https://kaleji.dev/posts/building-a-deterministic-invoice-validation-pipeline-in-kotlin/

---

"It showed something different yesterday."

That's the sentence you never want to hear in a compliance-sensitive system. If your pipeline processes the same input twice and produces different results — and you can't explain why — you have a trust problem.

We build invoice validation software. Audit trails, regulatory requirements, and Kanzlei workflows all demand determinism. But the same challenge shows up in any domain where results are stored, exported, or audited.

Determinism breaks in subtle ways:

→ A tenant setting changed between runs — same input, different context
→ A parser fix shipped — old documents now extract slightly differently
→ A rule references "now" — retry three hours later, different output
→ Jobs process concurrently — aggregation order varies

Five patterns that keep it reliable:

1. Pin everything at evaluation time (rules version, config snapshot, extraction version)
2. Never overwrite evaluations — create new ones, keep old ones for audit
3. Make jobs idempotent at both execution and outcome level
4. Isolate evaluation logic from side effects
5. Treat the current time as an explicit parameter, not an implicit one

The post covers each pattern in detail, with code examples, a production war story, and an honest look at the costs (storage growth, schema complexity, migration discipline).

https://kaleji.dev/posts/building-a-deterministic-invoice-validation-pipeline-in-kotlin/

#SoftwareArchitecture #BackendEngineering #AsyncProcessing #Determinism #Compliance #AuditTrail #SystemDesign #RechnungRadar
