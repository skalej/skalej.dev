---
title: "Correction Invoices and Storno in German E-Invoicing"
description: "Document chains, effective versions, and the double-counting problem when handling correction invoices and Storno in XRechnung and ZUGFeRD."
pubDatetime: 2026-01-26T15:45:00Z
draft: false
tags:
  - "xrechnung"
  - "e-invoicing"
  - "correction"
  - "storno"
  - "germany"
---

A supplier sends a correction invoice. Then a Storno. Then a new corrected version. If your system treats each document as independent, you end up double-counting amounts, exporting confused totals, and spending time untangling things during audit.

This is a common problem in German accounting workflows, and getting it right requires understanding how documents relate to each other.

## Table of contents

## Three document roles

Every e-invoice document falls into one of three roles:

- **Original**: the initial invoice from a supplier
- **Correction** (Rechnungskorrektur): a revised invoice that replaces or corrects a previous one
- **Storno** (Stornierung / Gutschrift): a document that cancels a previous invoice, often with negative totals

The supplier issues corrections and cancellations. Your Kanzlei or AP team needs to detect the role, link it to the right original, and make sure accounting exports reflect the correct effective amounts.

## Detecting corrections and cancellations

Both XRechnung syntaxes (UBL and CII) provide structured reference fields to indicate that a document relates to an earlier invoice, typically a reference to the original invoice number plus a document type code distinguishing standard invoices from credit notes.

The catch: these references are not always present. Some ERP systems omit them. Some suppliers put the reference in free-text notes instead of structured fields. So detection needs a fallback strategy:

1. **Structured reference** in the XML (highest confidence)
2. **Heuristic matching**: same supplier + referenced invoice number in text + matching amounts
3. **Manual linking**: a user selects the original when automatic detection fails

How this works should be configurable per mandant. Some clients want strict automatic linking, others prefer to review every link themselves. What matters is that the system supports both and makes the detection method transparent.

## Document chains

When a correction is linked to an original, they form a document chain:

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

Chains can combine both, too. A supplier cancels an invoice and issues a new corrected version.

The important concept here is the **effective version**: at any point, only one document in a chain should be treated as the active invoice for accounting. Earlier versions are superseded or canceled.

## The double-counting problem

If corrections and originals both end up in an accounting export without chain awareness, amounts get counted twice. This is the most common operational error I've seen.

Here's a concrete scenario. A supplier sends three documents over two months:

```
Jan 15 — Original Invoice #2024-042:      5.000,00 EUR
Jan 28 — Storno of #2024-042:            -5.000,00 EUR
Jan 29 — New Invoice #2024-042-K1:        4.800,00 EUR  (corrected amount)
```

The correct accounting outcome: **4.800 EUR** in the books.

But if the system treats each document independently:

- **Without chain awareness:** the export shows 5.000 + (-5.000) + 4.800 = 4.800 EUR. Correct by accident, only because the storno happened to carry a negative amount. If the storno gets excluded (some systems filter negatives), the books show 9.800 EUR.
- **With chain awareness:** the system knows #2024-042 is canceled, the storno neutralizes it, and #2024-042-K1 is the effective version. Only 4.800 EUR appears in the export. The other two documents stay accessible for audit.

Catching these chains manually across hundreds of invoices per month is not realistic.

## Effective version rules

Clear rules for what shows up in accounting exports:

### Corrections

- The latest correction in the chain is the effective version (assuming it's validated)
- Superseded originals get excluded from default accounting exports
- Both documents stay in the system for audit

### Cancellations (Storno)

- The canceled original gets excluded from exports
- The Storno itself depends on policy:
  - **Option A (more common):** exclude the Storno too. Net effect is zero, neither document appears
  - **Option B:** include the Storno as a separate line with a "CANCELED" status or negative amounts

This has to be configurable per mandant. Different clients follow different accounting conventions, and a Kanzlei processing invoices for 30 mandants can't enforce a single policy. Some mandants want stornos hidden entirely, others want them visible as negative entries.

## What Kanzlei offices actually need

**Visibility.** When looking at an invoice, it should be immediately clear if it's been superseded or canceled. Something like "This invoice was superseded by Correction #X on DATE" prevents staff from working on outdated documents.

**Chain navigation.** Staff need to see the full chain (original, corrections, cancellations) with amounts, dates, and status at a glance. And they need to click through to any document in the chain.

**Export safety.** Batch exports per mandant should automatically exclude superseded and canceled originals. Manual overrides should be restricted to admin roles and audit-logged.

**Unresolved references.** When a correction references an invoice number that doesn't exist in the system (maybe the original was processed before the system was adopted), flag it as a warning.

## Detection confidence

Not all links are equally reliable. Tracking confidence levels helps:

- **HIGH**: structured XML reference matches an existing invoice by number and supplier
- **MEDIUM**: heuristic match based on supplier + invoice number pattern + amounts
- **LOW**: partial match or reference found only in free text

Low-confidence links should be flagged for manual review rather than applied automatically. In Kanzlei workflows, incorrect linking could affect a mandant's books.

## Audit trail

Every linking decision, whether automatic or manual, needs to be recorded: who linked or unlinked the documents, when, what the previous state was, and which detection method was used. For Kanzlei offices where audit readiness is a baseline expectation, this is a core requirement.

## How I approached this in RechnungRadar

Getting corrections and cancellations right was one of the trickier parts of building [RechnungRadar](/projects/rechnungradar/). The key design decision was making linking an **orthogonal concern** to validation. A correction invoice goes through the same parse-validate-policy pipeline as any other invoice. The chain logic operates alongside it, not instead of it. That way, document role detection, chain tracking, and effective version management stay cleanly separated from structural and business rule validation.
