---
title: "Contract-to-Invoice Compliance: Catching Payment Term and Amount Mismatches Before Booking"
description: "How contract-to-invoice compliance checks work in practice — detecting payment term mismatches, recurring amount anomalies, and expired contract periods before invoices reach your accounting system."
pubDatetime: 2026-02-20T00:00:00Z
draft: false
tags:
  - "contract-compliance"
  - "e-invoicing"
  - "validation"
  - "accounts-payable"
  - "germany"
---

An invoice can be technically valid, pass all XRechnung/ZUGFeRD checks, satisfy your buyer policy requirements — and still be wrong. The payment terms don't match what's in the contract. The recurring service fee increased by 15% without notice. The contract expired two months ago.

These are **contract compliance** problems, and they're some of the most expensive invoice errors to catch manually. This post explains what contract-to-invoice compliance checks look like in practice and how I implemented them in [RechnungRadar](/projects/rechnungradar/).

## Table of contents

## The problem: valid invoices, wrong terms

Imagine a Kanzlei processing invoices for 30 mandants. A mandant has a SaaS contract at 500 EUR/month with Net 30 payment terms. One month, the invoice arrives at 575 EUR with Net 14 terms. Nothing about this invoice is structurally invalid. Schema validation passes. Buyer policy passes (PO is present, buyer reference is correct).

But the amount is 15% higher than agreed, and the payment terms were shortened by half. Without contract context, the accounting system books it without question. The mandant pays the wrong amount with the wrong timing, and nobody notices until the next contract review — if then.

This happens far more often than most teams realize, especially with:
- SaaS and subscription services that adjust pricing silently
- Service contracts where the vendor changes payment terms mid-contract
- Expired contracts where invoices keep arriving without a renewal
- Setup fees that appear on multiple invoices instead of just the first one

## What contract compliance checks cover

Contract compliance is a distinct validation layer that sits alongside (not inside) e-invoice validation and buyer policy checks. In the invoice detail view, results appear in three separate sections:

1. **E-Invoice / EN16931 Validation** — structural and arithmetic checks
2. **Buyer Policy** — organizational requirements (PO, buyer reference, cost center)
3. **Contract Compliance** — commercial terms alignment

The contract compliance rules I implemented in RechnungRadar's V1:

### Payment terms mismatch

Compare the contract's agreed payment terms (e.g., Net 30 days) against what the invoice states — either as explicit payment terms or derived from the issue date and due date.

- **WARN** if the mismatch is within a tolerance (e.g., a few days off, possibly due to weekends)
- **FAIL** if the terms are significantly different (e.g., Net 14 vs Net 30)

Evidence includes both the contract terms and the invoice terms, so the user can see the discrepancy immediately.

### Contract validity window

Check whether the invoice date (or service period, if present) falls within the contract's active period.

- **WARN** if the invoice is near the contract's expiry date
- **FAIL** if the invoice clearly falls outside the validity window

This catches the common case where a contract has expired but the vendor keeps sending invoices. It also catches invoices dated before the contract started — which can indicate a linking error.

### Recurring amount anomaly

For contracts with a known recurring fee (monthly subscription, quarterly service fee), compare the invoice total against the expected amount with a configurable tolerance.

- **WARN** if the deviation exceeds the tolerance percentage (default: 10%)
- **FAIL** for large deviations (configurable)

This is particularly useful for SaaS subscriptions where price increases might be applied without explicit communication. A 2% increase might be acceptable; a 30% jump should be flagged.

### One-time fee repetition

Some contracts include one-time fees (setup, onboarding, migration). If the system sees an invoice amount matching the one-time fee and the fee has already been invoiced before (checked against historical invoices linked to the same contract), it flags a potential duplicate charge.

- **WARN** or **FAIL** depending on configuration
- Evidence includes the current invoice and references to prior invoices where the fee appeared

### Renewal reminders

Not a per-invoice check, but a background job: when a contract's notice period or expiry date approaches, the system generates reminders. These are idempotent — the same contract and milestone only triggers one reminder.

## How contract linking works

For compliance checks to run, an invoice must be linked to a contract. The selection logic:

1. **Find candidate contracts** — filter by tenant/mandant and vendor (from the vendor master)
2. **Filter by validity** — the invoice date or service period should overlap the contract's active period. Auto-renewing contracts remain candidates unless explicitly expired.
3. **Pick the best match** — prefer a contract explicitly referenced on the invoice (if available), otherwise pick the most recently effective active contract
4. **If no match** — contract compliance shows "No linked contract" as INFO or WARN (configurable per mandant)

Manual linking is always available: a user can link or unlink an invoice to a specific contract, which triggers a re-run of contract compliance.

## The term confirmation model

Contract terms stored in the system have a state machine:

- **SUGGESTED_DRAFT** — extracted automatically from uploaded contract documents (using text extraction and clause classification). Cannot affect enforcement.
- **CONFIRMED_ACTIVE** — confirmed by an authorized user. These are the terms used for compliance checks.
- **RETIRED** — historical terms no longer in effect.

This is deliberate. The system can suggest terms from contract PDFs, but it never enforces unchecked suggestions. A human must confirm before terms affect invoice processing. This keeps the system trustworthy for audit-sensitive Kanzlei workflows.

## Overrides and audit

Sometimes a compliance failure is expected and acceptable — a negotiated price increase, a known early payment arrangement. For these cases, authorized users can override a finding:

- Override status: `FAIL` to `OVERRIDDEN_PASS` (or `WARN` to `OVERRIDDEN_PASS`)
- The override records: who, when, reason, previous status
- Overrides are immutable — they can't be silently removed

The full audit trail for contract compliance includes: contract edits, term confirmations, invoice linking changes, compliance results, and overrides. Everything is tenant-isolated and timestamped.

## Where it fits in the pipeline

Contract compliance runs **after** e-invoice validation and buyer policy checks. This ordering matters because:

- If an invoice fails to parse, there's nothing to check against a contract
- Buyer policy issues (missing PO, missing buyer reference) should surface first — they're usually faster to resolve
- Contract compliance is the final "commercial correctness" layer before an invoice is considered export-ready

Together, the three layers form a funnel: structural validity, then organizational policy, then commercial compliance. Each layer reduces the set of issues that reach the next one.

## The ROI for Kanzlei offices

For a Kanzlei processing invoices across many mandants, contract compliance checks are high-leverage. A single caught payment-term mismatch or recurring-fee anomaly can save hours of follow-up time. Multiply that across dozens of mandants and hundreds of invoices per month, and the cumulative impact is significant — especially when the alternative is catching these issues during a quarterly review, or not at all.
