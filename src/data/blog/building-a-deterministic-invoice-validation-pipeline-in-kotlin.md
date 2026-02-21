---
title: "Designing for Determinism in Async Processing Pipelines"
description: "Patterns for building async pipelines where the same input must always produce the same output — versioning, idempotency, and immutable evaluations in compliance-sensitive systems."
pubDatetime: 2026-02-06T00:00:00Z
draft: false
tags:
  - "architecture"
  - "async-processing"
  - "determinism"
  - "kotlin"
  - "backend-engineering"
---

Some systems must guarantee that the same input always produces the same output. Not as a best-effort property, but as a hard requirement — because auditors will ask, because regulators will check, because your users need to trust that re-running something won't silently change the answer.

Financial validation, compliance checks, medical data processing, insurance claim evaluation — any domain where results feed into audit trails or legal records has this constraint.

I ran into this while building [RechnungRadar](/projects/rechnungradar/), an e-invoice validation system for German accounting workflows. This post covers the patterns I found most useful for achieving determinism in async processing pipelines, and the subtle ways it breaks if you're not deliberate about it.

## Table of contents

## What breaks determinism

Determinism sounds simple — same input, same output. But in a real async pipeline, several things conspire against it:

**Mutable configuration.** Your validation rules reference tenant settings (e.g., "is a purchase order required?"). If that setting changes between two runs of the same input, the output changes. The input didn't change — the context did.

**Evolving logic.** You ship a bug fix to a parsing function. Now re-processing an old document produces slightly different extracted data, which produces different validation results. Was the old result wrong? Probably. But the user who exported a report last week sees different findings today, and that's a trust problem.

This is easy to overlook. Imagine a parser fix that changes how a date field is extracted from certain CII invoices. Correct fix — but now re-processing historical invoices produces slightly different findings. Anyone who already exported a report based on the old evaluation sees a discrepancy they can't explain. The fix itself was right. What's missing is version-pinning the parser, so you can explain: "the old result used parser v1, the new result uses parser v2, here's what changed."

**External dependencies.** A rule calls an external service to verify a VAT ID. The service returns a different response today than it did yesterday (network error, updated data, rate limit). Your output is now non-deterministic through no fault of your own.

**Non-deterministic ordering.** You process items concurrently and aggregate results. If the aggregation depends on processing order (e.g., "first match wins"), and the order varies across runs, the output varies too.

**Time-dependent logic.** A rule says "warn if the invoice is older than 90 days." Run it today: no warning. Run it tomorrow: warning. Same input, different output — because "now" is an implicit input you didn't pin.

## Pattern 1: Pin everything at evaluation time

The core idea: when you evaluate an input, capture a snapshot of everything that could affect the output. Store these snapshots alongside the result.

In practice, this means recording:

- **Which version of the rules ran.** Not "the current version" — the specific version identifier that was active at evaluation time.
- **What the configuration looked like.** A hash or snapshot of the tenant/org settings that rules reference.
- **Which version of the extraction/parsing logic ran.** If your parser changes how it reads a field, that affects downstream results.

Conceptually, every evaluation carries a context like this:

```kotlin
data class EvaluationContext(
    val inputHash: String,           // SHA-256 of the original document
    val rulesetVersion: String,      // e.g., "0.3"
    val configHash: String,          // hash of tenant settings at eval time
    val parserVersion: String,       // extraction logic version
    val evaluationTimestamp: Instant  // pinned, not "now"
)
```

These pins serve two purposes:
1. **Reproducibility** — given the pins, you can explain exactly why a result looks the way it does.
2. **Comparison** — when you re-process with new rules, you can diff the old and new results and show users exactly what changed and why.

The alternative — re-running without pins and hoping for the same result — fails as soon as any of the inputs you forgot to pin changes underneath you.

## Pattern 2: Immutable evaluations

When you re-process an input (because rules changed, a bug was fixed, or configuration was updated), don't overwrite the previous evaluation. Create a new one.

This sounds wasteful, but it solves several problems at once:

- **Audit trail.** Auditors can see what the system said at any point in time.
- **Safe rollback.** If the new rules produce worse results, you still have the old evaluation.
- **Diffing.** Users can compare evaluations and see "rule X was added, finding Y is new."
- **No lost evidence.** If someone exported a report based on evaluation v1, that report remains explainable even after evaluation v2 exists.

The "current" evaluation is a pointer, not a mutation. You update which evaluation is active, but you never delete or modify past ones.

## Pattern 3: Make jobs idempotent

In any async pipeline, jobs will be retried — because workers crash, networks fail, timeouts trigger. If retrying a job produces a different result or creates duplicate records, you have a problem.

Idempotency in processing pipelines requires attention at two levels:

**Job-level idempotency.** The same job running twice must not create duplicate work. This means either deduplicating by a natural key before writing results, or using "insert if not exists" semantics.

**Outcome-level idempotency.** The same input processed with the same pinned versions must produce byte-for-byte identical results. This rules out things like timestamps in the output ("evaluated_at" should be the job's timestamp, not `now()`), random IDs in findings, or order-dependent serialization.

A useful test: run your pipeline twice on the same input with the same version pins, serialize both outputs, and diff them. If the diff is non-empty, you have a determinism leak.

## Pattern 4: Isolate side effects from evaluation

Keep the evaluation function pure: it takes an input and a context (rules, config), and returns results. No database writes, no external calls, no state mutations inside the evaluation.

Side effects (storing results, updating status, sending notifications) happen in a wrapper around the evaluation, not inside it. This means:

- You can unit-test evaluations without a database
- You can re-run evaluations in dry-run mode
- The evaluation logic is the same whether called from a job worker, an API endpoint, or a test

This isn't always achievable — some rules genuinely need to query historical data (e.g., "has this vendor sent this amount before?"). But even then, the query results should be captured as part of the evaluation context (snapshotted), not re-queried on each retry.

## Pattern 5: Treat "now" as an input

Any rule that references the current time is an implicit source of non-determinism. "Warn if older than 90 days" will produce different results on different days.

The fix: pass the evaluation timestamp as an explicit parameter. Pin it when the job is created, not when the job runs. If a job is retried three hours later, it still uses the original timestamp.

This also makes time-dependent rules testable — you can pass any timestamp and assert against it, without mocking system clocks.

## The costs are real

These patterns aren't free. You should know what you're signing up for:

**Storage growth.** Immutable evaluations mean you're keeping every version. For a system processing thousands of documents per month, evaluation history grows fast. You'll need a retention policy and a strategy for archiving old evaluations without losing audit access.

**Schema complexity.** Version columns, hash columns, evaluation snapshots, pointer tables for "current evaluation" — the data model gets more complex. Migrations need discipline, and every new feature must respect the versioning contract.

**Migration discipline.** When you add a new version pin (say, a new config parameter that affects outcomes), you need to backfill or default it for existing evaluations. This is manageable but requires awareness — you can't just add a column and ignore history.

**Cognitive overhead.** Developers must understand that evaluation is not "run the rules and save the result." It's "capture context, run the rules, store the result alongside the context, never mutate." This takes onboarding and code review discipline.

## When determinism isn't worth the cost

Not every pipeline needs this. If your results are ephemeral (a live search ranking, a recommendation feed), the cost of versioning and pinning outweighs the benefit.

But if your results are:
- Stored and referenced later
- Used in reports that get exported
- Subject to audit
- Shown to users who expect stability

Then determinism isn't optional. It's a prerequisite for trust.

The patterns above add complexity, but they eliminate an entire class of problems — the kind where someone asks "this showed something different yesterday" and you have no way to explain why.

The investment pays off the first time an auditor asks for a historical finding and you can produce it exactly as it was, with full provenance.
