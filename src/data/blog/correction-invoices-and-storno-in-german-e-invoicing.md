---
title: "Correction Invoices and Storno in German E-Invoicing"
description: "How correction invoices and Storno (cancellations) work in XRechnung and ZUGFeRD — document chains, effective versions, and avoiding double-counting in accounting exports."
pubDatetime: 2026-01-30T00:00:00Z
draft: false
tags:
  - "xrechnung"
  - "e-invoicing"
  - "correction"
  - "storno"
  - "germany"
---

In German accounting workflows, invoices are not always final. Suppliers issue **correction invoices** (Rechnungskorrektur) to fix errors and **Storno documents** (Stornierungen) to cancel invoices entirely. If your system treats each document as independent, you end up with double-counted amounts, confused exports, and audit problems.

This post covers how corrections and cancellations work in structured e-invoices (XRechnung and ZUGFeRD), how to link them reliably, and what Kanzlei offices need to handle them correctly.

## Table of contents

## The three document roles

Every e-invoice document falls into one of three roles:

- **Original** — the initial invoice document received from a supplier
- **Correction** (Rechnungskorrektur) — a revised invoice that replaces or corrects a previous one
- **Storno** (Stornierung / Gutschrift) — a document that cancels a previous invoice, often with negative totals

The supplier issues corrections and cancellations. The receiving side (your Kanzlei or AP team) needs to detect the role, link it to the right original, and ensure accounting exports reflect the correct effective amounts.

## How corrections and cancellations appear in XRechnung

Both UBL and CII provide structured reference fields to indicate that a document relates to an earlier invoice.

In **UBL**, a correction invoice may include a `BillingReference` element pointing to the original invoice number. The `InvoiceTypeCode` can also indicate a credit note (code `381`) versus a standard invoice (code `380`).

In **CII**, the equivalent mechanism uses `InvoiceReferencedDocument` within the header, referencing the original invoice number and optionally the issue date.

In practice, these references are not always present or complete. Some ERP systems omit them. Some suppliers include a reference in free-text notes instead of structured fields. This means detection needs a fallback strategy:

1. **Structured reference** in the XML (highest confidence)
2. **Heuristic matching** — same supplier + referenced invoice number in text + matching amounts
3. **Manual linking** — a user selects the original invoice when automatic detection fails

## Document chains

When a correction is linked to an original, they form a **document chain**:

```
Original Invoice #2024-001
  └── Correction Invoice #2024-001-K1 (supersedes original)
        └── Correction Invoice #2024-001-K2 (supersedes K1)
```

Or for cancellations:

```
Original Invoice #2024-002
  └── Storno #2024-002-S (cancels original)
```

Chains can also combine both — a supplier cancels an invoice and then issues a new corrected version.

The critical concept is the **effective version**: at any point, only one document in a chain should be treated as the active invoice for accounting purposes. Earlier versions are superseded or canceled.

## The double-counting problem

If corrections and originals are both included in an accounting export without chain awareness, amounts get counted twice. This is the most common operational error.

Consider a simple example:

- Original invoice: 10,000 EUR (net)
- Correction invoice: 9,500 EUR (net) — corrects a pricing error

If both appear in the monthly DATEV export, the books show 19,500 EUR instead of 9,500 EUR. For Kanzlei offices processing hundreds of invoices per month across multiple mandants, catching these manually is unreliable.

## Effective version rules for accounting

A sound system needs clear rules for what appears in accounting exports:

### Corrections
- The **correction** is the effective version (if it's the latest in the chain and validated)
- The **superseded original** is excluded from default accounting exports
- Both documents remain in the system for audit purposes

### Cancellations (Storno)
- The **canceled original** is excluded from accounting exports
- How the Storno document itself is handled depends on policy:
  - **Option A (common):** exclude the Storno too — the net effect is zero, and neither document appears in the export
  - **Option B:** include the Storno as a separate line with a "CANCELED" status or negative amounts

For Kanzlei workflows, this should be a configurable setting per mandant, since different clients may follow different accounting conventions.

## What Kanzlei offices need

Kanzlei offices processing invoices for multiple mandants have specific requirements around corrections and cancellations:

**Visibility** — when viewing an invoice, it must be immediately clear if it has been superseded or canceled. Banners like "This invoice was superseded by Correction #X on DATE" prevent staff from accidentally working on outdated documents.

**Chain navigation** — staff need to see the full document chain (original, corrections, cancellations) with key fields (amounts, dates, status) at a glance, and navigate between documents.

**Export safety** — batch exports per mandant must automatically exclude superseded and canceled originals. Manual overrides should be restricted to admin roles and audit-logged.

**Unresolved references** — when a correction references an invoice number that doesn't exist in the system (maybe the original was processed before the system was adopted), this should be flagged as a warning so staff can investigate.

## Detection confidence

Not all links are equally reliable. A system should track detection confidence:

- **HIGH** — structured XML reference matches an existing invoice by number and supplier
- **MEDIUM** — heuristic match based on supplier + invoice number pattern + amounts
- **LOW** — partial match or reference found only in free text

Low-confidence links should be flagged for manual review rather than applied automatically. This is especially important in Kanzlei workflows where incorrect linking could affect a mandant's books.

## Audit trail

Every linking decision — whether automatic or manual — must be recorded:

- Who linked or unlinked the documents (system or user)
- When it happened
- What the previous state was
- The detection method used

This is non-negotiable for Kanzlei offices where audit readiness is a core requirement.

## Building this into RechnungRadar

Handling corrections and cancellations reliably was one of the more nuanced features to build in [RechnungRadar](/projects/rechnungradar/). The system detects document roles from XML references, links them into chains, tracks effective versions, and ensures accounting exports only include the correct documents — with full audit trail and per-mandant policy configuration.

The key design decision was making linking an **orthogonal concern** to validation: a correction invoice goes through the same parse-validate-policy pipeline as any other invoice, and the linking/chain logic operates alongside it rather than replacing it.
