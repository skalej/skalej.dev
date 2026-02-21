---
title: "Designing for Determinism in Async Processing Pipelines"
description: "Patterns for building async pipelines where the same input must always produce the same output, and the subtle ways determinism breaks if you're not careful."
pubDatetime: 2026-02-03T09:15:00Z
draft: false
tags:
  - "architecture"
  - "async-processing"
  - "determinism"
  - "kotlin"
  - "backend-engineering"
---

Some systems must guarantee that the same input always produces the same output. Not as a nice-to-have, but as a hard requirement. Auditors will ask. Regulators will check. Users need to trust that re-running something won't silently change the answer.

Financial validation, compliance checks, medical data processing, insurance claim evaluation. Any domain where results feed into audit trails or legal records has this constraint.

I ran into this while building [RechnungRadar](/projects/rechnungradar/), an e-invoice validation system for German accounting workflows. These are the patterns that worked best, and the subtle ways determinism breaks when you're not paying attention.

## Table of contents

## What breaks determinism

Same input, same output. Sounds simple. In a real async pipeline, several things work against it.

**Mutable configuration.** Your validation rules reference tenant settings ("is a purchase order required?"). If that setting changes between two runs of the same input, the output changes. The input didn't change. The context did.

**Evolving logic.** You ship a bug fix to a parsing function. Re-processing an old document now produces slightly different extracted data, which produces different validation results. The old result was probably wrong. But the user who exported a report last week sees different findings today and can't explain why.

Here's a scenario that caught me off guard: a parser fix that changes how a date field is extracted from certain CII invoices. Correct fix. But now re-processing historical invoices produces slightly different findings. Anyone who exported a report based on the old evaluation sees a discrepancy. The fix itself was right. What was missing: version-pinning the parser so you can explain "the old result used parser v1, the new result uses parser v2, here's what changed."

**External dependencies.** A rule calls an external service to verify a VAT ID. The service returns a different response today than yesterday (network error, updated data, rate limit). Your output is now non-deterministic through no fault of your own.

**Non-deterministic ordering.** You process items concurrently and aggregate results. If the aggregation depends on processing order ("first match wins") and the order varies across runs, the output varies too.

**Time-dependent logic.** A rule says "warn if the invoice is older than 90 days." Run it today: no warning. Run it tomorrow: warning. Same input, different output, because "now" is an implicit input you didn't pin.

## Pin everything at evaluation time

The core idea: when you evaluate an input, capture a snapshot of everything that could affect the output. Store these snapshots alongside the result.

What this means in practice:

- **Which version of the rules ran.** Not "the current version" but the specific version identifier that was active at evaluation time.
- **What the configuration looked like.** A hash or snapshot of the tenant/org settings that rules reference.
- **Which version of the extraction/parsing logic ran.** Parser changes affect downstream results.

Every evaluation carries a context like this:

```kotlin
data class EvaluationContext(
    val inputHash: String,           // SHA-256 of the original document
    val rulesetVersion: String,      // e.g., "0.3"
    val configHash: String,          // hash of tenant settings at eval time
    val parserVersion: String,       // extraction logic version
    val evaluationTimestamp: Instant  // pinned, not "now"
)
```

These pins do two things:
1. **Reproducibility.** Given the pins, you can explain exactly why a result looks the way it does.
2. **Comparison.** When you re-process with new rules, you can diff the old and new results and show users exactly what changed.

Without pins, re-running and hoping for the same result fails the moment any input you forgot to capture changes underneath you.

## Immutable evaluations

When you re-process an input (rules changed, a bug was fixed, configuration was updated), don't overwrite the previous evaluation. Create a new one.

This sounds wasteful. It solves several problems at once:

- **Audit trail.** Auditors can see what the system said at any point in time.
- **Safe rollback.** If the new rules produce worse results, you still have the old evaluation.
- **Diffing.** Users can compare evaluations: "rule X was added, finding Y is new."
- **No lost evidence.** If someone exported a report based on evaluation v1, that report remains explainable even after v2 exists.

The "current" evaluation is a pointer, not a mutation. You update which evaluation is active, but you never delete or modify past ones.

## Make jobs idempotent

In any async pipeline, jobs will be retried. Workers crash, networks fail, timeouts fire. If retrying a job produces a different result or creates duplicate records, you have a problem.

Idempotency needs attention at two levels:

**Job-level.** The same job running twice must not create duplicate work. Either deduplicate by a natural key before writing results, or use "insert if not exists" semantics.

**Outcome-level.** The same input processed with the same pinned versions must produce byte-for-byte identical results. This rules out timestamps in the output ("evaluated_at" should be the job's timestamp, not `now()`), random IDs in findings, or order-dependent serialization.

A useful test: run your pipeline twice on the same input with the same version pins, serialize both outputs, and diff them. If the diff is non-empty, you have a determinism leak.

## Isolate side effects from evaluation

Keep the evaluation function pure: it takes an input and a context (rules, config), and returns results. No database writes, no external calls, no state mutations inside the evaluation.

Side effects (storing results, updating status, sending notifications) happen in a wrapper around the evaluation, not inside it:

- You can unit-test evaluations without a database
- You can re-run evaluations in dry-run mode
- The evaluation logic works the same whether called from a job worker, an API endpoint, or a test

Not always fully achievable. Some rules genuinely need to query historical data ("has this vendor sent this amount before?"). But even then, the query results should be captured as part of the evaluation context and snapshotted, not re-queried on each retry.

## Treat "now" as an input

Any rule that references the current time is an implicit source of non-determinism. "Warn if older than 90 days" produces different results on different days.

The fix: pass the evaluation timestamp as an explicit parameter. Pin it when the job is created, not when the job runs. If a job gets retried three hours later, it still uses the original timestamp.

This also makes time-dependent rules testable. You can pass any timestamp and assert against it without mocking system clocks.

## The costs

These patterns aren't free.

**Storage growth.** Immutable evaluations mean keeping every version. For a system processing thousands of documents per month, evaluation history grows fast. You'll need a retention policy and a strategy for archiving old evaluations without losing audit access.

**Schema complexity.** Version columns, hash columns, evaluation snapshots, pointer tables for "current evaluation." The data model gets more complex. Migrations need discipline, and every new feature has to respect the versioning contract.

**Migration discipline.** When you add a new version pin (a new config parameter that affects outcomes), you need to backfill or default it for existing evaluations. Manageable, but you can't just add a column and ignore history.

**Cognitive overhead.** Developers have to internalize that evaluation is not "run the rules and save the result." It's "capture context, run the rules, store the result alongside the context, never mutate." Takes onboarding and code review discipline.

## When to skip all this

Not every pipeline needs this level of rigor. If your results are ephemeral (a live search ranking, a recommendation feed), the cost of versioning and pinning outweighs the benefit.

But if results are stored and referenced later, used in exported reports, subject to audit, or shown to users who expect stability, then determinism isn't optional. It's a prerequisite for trust.

These patterns add complexity. They also eliminate an entire class of "it showed something different yesterday" problems where you have no way to explain why. The investment pays off the first time an auditor asks for a historical finding and you can produce it exactly as it was, with full provenance.
