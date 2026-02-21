---
title: "Building a Deterministic Invoice Validation Pipeline in Kotlin"
description: "How I designed a deterministic, versioned validation pipeline for e-invoices using Kotlin and Spring Boot — covering rule versioning, idempotent processing, async job queues, and audit requirements."
pubDatetime: 2026-02-06T00:00:00Z
draft: false
tags:
  - "kotlin"
  - "spring-boot"
  - "architecture"
  - "validation"
  - "e-invoicing"
---

When I started building the validation engine for [RechnungRadar](/projects/rechnungradar/), the core requirement was deceptively simple: given an e-invoice, produce a list of findings. But in a system used by Kanzlei offices for audit-sensitive accounting workflows, "produce findings" comes with hard constraints — determinism, versioning, idempotency, and auditability.

This post covers the key architectural decisions behind the validation pipeline.

## Table of contents

## Why determinism matters

A validation system for accounting must guarantee: **same input + same rules = same findings, every time.** This isn't just a nice-to-have. Kanzlei offices need it because:

- Audit trails must be reproducible. If an auditor asks "why was this invoice flagged?", the answer must be consistent with what the system showed at the time.
- Re-processing invoices after rule changes must produce explainably different results, not random variation.
- Batch operations across hundreds of mandants must behave consistently.

This rules out anything non-deterministic in the validation path: no random sampling, no ML-based scoring without pinned versions, no reliance on external services that might return different results on retry.

## Rule packs and versioning

Each validation rule is a Kotlin class that implements a common interface:

```kotlin
interface ValidationRule {
    val code: String        // e.g., "RR-TOT-001"
    val category: RuleCategory
    val severity: Severity

    fun evaluate(invoice: NormalizedInvoice, context: ValidationContext): RuleResult
}
```

Rules are grouped into **rule packs** with a version string (e.g., `"0.2"`). When an invoice is uploaded, the current rule pack version is pinned to that invoice. If rules change later, the invoice retains its original evaluation — unless explicitly re-processed with the new version.

This versioning is stored per invoice:

- `ruleset_version` — which rule pack was applied
- `config_hash` — a hash of the organization's settings at evaluation time (e.g., whether buyer reference is required)
- `extractor_version` — which parsing/extraction logic version was used

Together, these three values make any evaluation fully reproducible.

## The processing pipeline

Every invoice goes through the same stages:

```
Upload → Store → Queue → Parse → Normalize → Validate → Policy Check → Done
```

Each stage is a distinct step with clear inputs and outputs:

1. **Upload & store** — the file is persisted to object storage with a content-hash based dedup check. If the same file (by SHA-256) has already been uploaded for this organization, the upload is rejected as a duplicate.

2. **Queue** — a processing job is created in a durable job queue (PostgreSQL table). Jobs use `FOR UPDATE SKIP LOCKED` for concurrent worker safety.

3. **Parse** — the file is classified (UBL XML, CII XML, or ZUGFeRD PDF) and parsed using streaming StAX parsing. ZUGFeRD PDFs have their embedded XML extracted first via PDFBox.

4. **Normalize** — both UBL and CII produce a common `NormalizedInvoice` model. This is the single data structure that all downstream rules operate on. Having one normalized model means rules don't need format-specific logic.

5. **Validate** — the rule pack runs against the normalized invoice. Each rule produces a `RuleResult` with a code, severity, message, evidence, and optional suggested fix.

6. **Policy check** — organization-specific rules (buyer reference required, PO required, contract compliance) run as a separate pass. These are configurable per tenant or mandant and versioned independently.

## Idempotent job processing

The worker runtime polls the `processing_jobs` table for queued jobs. Several things make this safe for concurrent and retry scenarios:

**Lock-based dedup** — `SELECT ... FOR UPDATE SKIP LOCKED` ensures two workers never process the same job simultaneously. If a worker crashes mid-processing, the lock times out after 2 minutes and the job becomes available again.

**Retry with backoff** — failed jobs are re-queued with exponential backoff (1s base, 2x multiplier, 30s max). After 3 attempts, a job moves to `DEAD` status and requires manual intervention.

**Idempotent outcomes** — re-processing the same invoice with the same rule version produces the same findings. Findings are stored as a set keyed by `(invoice_id, rule_code, ruleset_version)`, so re-running doesn't create duplicates.

**Graceful shutdown** — when the worker receives a shutdown signal, it releases held locks before stopping. This prevents jobs from being stuck in a locked state until the timeout expires.

## Separating API and worker runtimes

The system runs as two logical processes from the same codebase:

- **API runtime** — handles HTTP requests (upload, query, export). No job polling.
- **Worker runtime** — polls for jobs and runs the processing pipeline. No external HTTP serving.

This separation matters for a few reasons:

- Upload spikes don't compete with processing for resources
- Workers can be scaled independently
- A slow validation run doesn't block API response times
- Each runtime can be health-checked independently (API checks DB connectivity; worker checks job processing lag)

Both runtimes share the same domain code and database, just with different Spring profiles activating different components.

## Evidence and redaction

Every finding includes **evidence** — the specific values that triggered the rule. For example, a VAT mismatch finding includes the declared total and the computed sum. This makes findings actionable without requiring the user to dig into raw XML.

But evidence must be redacted carefully. Invoice data can contain sensitive information (addresses, line item descriptions, free-text notes). The policy:

- Evidence is capped at 512 characters
- Only numeric values, dates, and identifiers are included (invoice number, buyer reference, PO number)
- No addresses, line item descriptions, or free-text notes in evidence
- No full XML fragments stored

This keeps the audit trail informative without creating a data-sensitivity liability.

## Re-processing

When rules change, affected invoices can be re-processed. Re-processing creates a **new evaluation snapshot** — it never mutates the existing one. This means:

- The original evaluation remains accessible for audit
- The new evaluation references the new `ruleset_version`
- A diff between evaluations shows exactly what changed and why

Re-processing can be triggered manually (for specific invoices) or in batch (for all invoices in a mandant when a policy changes).

## What I'd do differently

The main thing I'd reconsider is the polling interval for the worker. At 1000ms with a batch size of 10, there's an inherent latency floor of up to 1 second between upload and processing start. For most accounting workflows this is fine, but if near-real-time feedback matters, an event-driven trigger (Spring events or a lightweight message broker) on top of the durable queue would reduce that latency without sacrificing reliability.

The overall architecture — versioned rules, normalized model, idempotent processing, separated runtimes — has held up well as the system grew from basic validation to contract compliance and correction/storno chain handling.
