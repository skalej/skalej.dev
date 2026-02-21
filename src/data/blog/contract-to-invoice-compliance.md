---
title: "Contract-to-Invoice Compliance: Catching Payment Term and Amount Mismatches Before Booking"
description: "Detecting payment term mismatches, silent price increases, and expired contracts before invoices reach your accounting system."
pubDatetime: 2026-02-19T14:00:00Z
draft: false
tags:
  - "contract-compliance"
  - "e-invoicing"
  - "validation"
  - "accounts-payable"
  - "germany"
---

An invoice can be technically valid. Passes all XRechnung/ZUGFeRD checks. Satisfies buyer policy requirements. And still be wrong. The payment terms don't match what's in the contract. The recurring service fee went up 15% without notice. The contract expired two months ago.

These are contract compliance problems, and they're some of the most expensive invoice errors to catch by hand.

## Table of contents

## Valid invoices, wrong terms

Picture a Kanzlei processing invoices for 30 mandants. One mandant has a SaaS contract at 500 EUR/month with Net 30 payment terms. One month, the invoice arrives at 575 EUR with Net 14. Nothing about this invoice is structurally invalid. Schema validation passes. Buyer policy passes (PO is present, buyer reference is correct).

But the amount is 15% higher than agreed, and the payment terms were shortened by half. Without contract context, the accounting system books it without question. The mandant pays the wrong amount on the wrong schedule, and nobody notices until the next contract review. If then.

This happens more often than you'd expect, especially with:
- SaaS and subscription services that adjust pricing silently
- Service contracts where vendors change payment terms mid-contract
- Expired contracts where invoices keep arriving without a renewal
- Setup fees that show up on multiple invoices instead of just the first

## What contract compliance covers

Contract compliance is a validation layer that sits alongside e-invoice validation and buyer policy checks. Each incoming invoice passes through increasingly specific checks:

```
  ┌─────────────────────────────────────┐
  │  E-Invoice / EN16931 Validation     │  ← Is it structurally valid?
  └──────────────┬──────────────────────┘
                 ▼
  ┌─────────────────────────────────────┐
  │  Buyer Policy                       │  ← Does it meet org requirements?
  └──────────────┬──────────────────────┘
                 ▼
  ┌─────────────────────────────────────┐
  │  Contract Compliance                │  ← Does it match agreed terms?
  └─────────────────────────────────────┘
```

Each layer catches a different category of problems. An invoice can pass one and fail the next. Results appear in separate sections so users see exactly where issues are.

Here's what I implemented for contract compliance in [RechnungRadar](/projects/rechnungradar/)'s V1:

### Payment terms mismatch

Compare the contract's agreed payment terms (Net 30 days) against what the invoice states, either as explicit terms or derived from the issue date and due date.

- **WARN** if the mismatch is small (a few days off, possibly weekends)
- **FAIL** if the terms are significantly different (Net 14 vs Net 30)

Evidence includes both the contract terms and the invoice terms so the user sees the discrepancy immediately.

### Contract validity window

Check whether the invoice date (or service period) falls within the contract's active period.

- **WARN** if the invoice is near the contract's expiry
- **FAIL** if it clearly falls outside the validity window

Catches expired contracts where vendors keep sending invoices. Also catches invoices dated before the contract started, which usually indicates a linking error.

### Recurring amount anomaly

For contracts with a known recurring fee (monthly subscription, quarterly service), compare the invoice total against the expected amount with a configurable tolerance.

- **WARN** if the deviation exceeds the tolerance (default: 10%)
- **FAIL** for large deviations (configurable threshold)

Particularly useful for SaaS subscriptions where price increases get applied without explicit communication. A 2% bump might be fine. A 30% jump should be flagged.

### One-time fee repetition

Some contracts include one-time fees (setup, onboarding, migration). If the system sees an invoice amount matching the one-time fee and that fee has already been invoiced before (checked against historical invoices linked to the same contract), it flags a potential duplicate charge.

- **WARN** or **FAIL** depending on configuration
- Evidence includes the current invoice and references to prior invoices where the fee appeared

### Renewal reminders

Not a per-invoice check but a background job: when a contract's notice period or expiry date approaches, the system generates reminders. These are idempotent, so the same contract and milestone only triggers one reminder.

## How contract linking works

For compliance checks to run, an invoice must be linked to a contract:

1. **Find candidates**: filter by tenant/mandant and vendor (from the vendor master)
2. **Filter by validity**: the invoice date or service period should overlap the contract's active period. Auto-renewing contracts stay as candidates unless explicitly expired
3. **Pick the best match**: prefer a contract explicitly referenced on the invoice, otherwise pick the most recently effective active contract
4. **No match found**: contract compliance shows "No linked contract" as INFO or WARN (configurable per mandant)

Manual linking is always available. A user can link or unlink an invoice to a specific contract, which triggers a re-run of contract compliance.

## Term confirmation

Contract terms stored in the system follow a state machine:

- **SUGGESTED_DRAFT**: extracted automatically from uploaded contract documents (text extraction and clause classification). Cannot affect enforcement.
- **CONFIRMED_ACTIVE**: confirmed by an authorized user. These are the terms actually used for compliance checks.
- **RETIRED**: historical terms no longer in effect.

The system can suggest terms from contract PDFs, but it never enforces unchecked suggestions. A human confirms before terms affect invoice processing. This matters for audit-sensitive Kanzlei workflows where you can't have automated guesses silently influencing validation.

## Overrides and audit

Sometimes a compliance failure is expected. A negotiated price increase, a known early payment arrangement. For these cases, authorized users can override a finding:

- Override status: `FAIL` to `OVERRIDDEN_PASS` (or `WARN` to `OVERRIDDEN_PASS`)
- The override records who, when, the reason, and previous status
- Overrides are immutable and can't be silently removed

The full audit trail for contract compliance includes contract edits, term confirmations, invoice linking changes, compliance results, and overrides. Everything is tenant-isolated and timestamped.

## Where it fits in the pipeline

Contract compliance runs after e-invoice validation and buyer policy checks. The ordering matters:

- If an invoice fails to parse, there's nothing to check against a contract
- Buyer policy issues (missing PO, missing buyer reference) should surface first since they're usually faster to resolve
- Contract compliance is the final "commercial correctness" layer before an invoice is considered export-ready

Together, the three layers form a funnel: structural validity, then organizational policy, then commercial compliance.

## The leverage for Kanzlei offices

For a Kanzlei processing invoices across many mandants, contract compliance checks are high-leverage. In subscription-heavy portfolios, recurring amount anomalies (silent price increases, changed billing cycles, duplicate charges) affect roughly 3-7% of invoices. Those costs go unnoticed without systematic checks.

A single caught payment-term mismatch or recurring-fee anomaly saves hours of follow-up. Across dozens of mandants and hundreds of invoices per month, that adds up, especially when the alternative is catching these issues during a quarterly review. Or not at all.
