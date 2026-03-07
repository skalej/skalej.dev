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

This is a common problem in German accounting workflows, and getting it right requires understanding how documents relate to each other — and what the consequences are when they don't.

## Table of contents

## 1. Three document roles

Every e-invoice document falls into one of three roles under German tax law:

- **Original**: the initial invoice from a supplier
- **Correction** (Rechnungskorrektur): a revised invoice that replaces or corrects a previous one (§ 14 Abs. 2 Satz 2 UStG)
- **Storno** (Stornierung): a document that cancels a previous invoice, issued by the original supplier. Cancellation intent is conveyed via the document type code (e.g., UN/EDIFACT code 381 or 384 in the EN 16931 codelist), which may or may not be accompanied by negative amounts depending on the issuing ERP.

> **Terminology note:** Supplier documents labeled "Gutschrift" are often functionally Stornorechnungen. The label alone does not determine the legal document type — the structured type code and document content do. A proper Gutschrift under § 14 Abs. 2 Satz 2 UStG is a buyer-issued self-billing credit, a distinct instrument with different VAT implications.

The supplier issues corrections and cancellations. Your Kanzlei or AP team needs to detect the role, link it to the right original, and make sure accounting exports reflect the correct buchungsrelevante amounts.

## 2. Risk matrix: the cost of improper linking

Inaccurately processed document chains create direct financial liabilities during a Betriebsprüfung. These are not edge cases — they are the predictable result of any system that treats corrections and originals as independent documents.

| Risk | Legal basis | Operational cause | Impact |
|---|---|---|---|
| Invalid input VAT deduction | § 15 Abs. 1 Satz 1 UStG | Using a canceled or superseded original as the accounting record | Immediate loss of Vorsteuer; correction required in Umsatzsteuervoranmeldung |
| VAT correction obligation | § 17 Abs. 1 UStG | Missing a cancellation that spans a closed reporting period | Interest charges under § 233a AO; possible amended return required |
| Double-counted OPOS entries | GoBD / HGB | Exporting both original and correction without chain awareness | Overstated liabilities; distorted Offene-Posten-Liste |

## 3. Detecting corrections and cancellations

Both XRechnung syntaxes (UBL and CII) provide structured reference fields to indicate that a document relates to an earlier invoice, typically a reference to the original invoice number plus a document type code distinguishing standard invoices from credit notes.

The catch: these references are not always present. Some ERP systems omit them. Some suppliers put the reference in free-text notes instead of structured fields. A robust system needs a fallback strategy:

1. **Structured reference** in the XML (highest confidence)
2. **Heuristic matching**: same supplier + referenced invoice number in text + matching amounts
3. **Manual linking**: a user selects the original when automatic detection fails

How this works should be configurable per Mandant. Some clients want strict automatic linking, others prefer to review every link themselves. What matters is that the system supports both and makes the detection method transparent.

## 4. Document chains

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

Chains can combine both. A supplier cancels an invoice and issues a new corrected version — three documents, one underlying transaction.

The central concept is the **buchungsrelevante Version** (effective version for accounting): at any point, only one document in a chain is the candidate for new bookings. Earlier versions are superseded or neutralized — but never removed from the system. If the original was already posted before the correction arrived, both entries remain in the ledger; the correction is booked as a separate OPOS-Ausgleich entry that offsets the original, rather than replacing it.

## 5. The double-counting problem

If corrections and originals both end up in an accounting export without chain awareness, amounts get counted twice. This is the most common operational error in AP workflows handling high invoice volumes.

Here's a concrete scenario. A supplier sends three documents over two months:

```
Jan 15 — Original Invoice #2024-042:      5.000,00 EUR
Jan 28 — Storno of #2024-042:            -5.000,00 EUR
Jan 29 — New Invoice #2024-042-K1:        4.800,00 EUR  (corrected amount)
```

The correct accounting outcome: **4.800 EUR** in the books.

But if the system treats each document independently:

- **Without chain awareness:** the export shows 5.000 + (-5.000) + 4.800 = 4.800 EUR. Correct by accident, only because the Storno happened to carry a negative amount. If the Storno gets filtered out — some systems suppress negative-amount documents — the books show 9.800 EUR.
- **With chain awareness:** the system knows #2024-042 is neutralized via Storno, and #2024-042-K1 is the buchungsrelevante Version. If the original was never posted, only 4.800 EUR enters the books. If the original was already posted, the Storno and the new invoice are booked as OPOS-Ausgleich entries — the ledger shows three lines netting to 4.800 EUR, which is correct. All documents remain in the archive, auditable and GoBD-compliant.

Catching these chains manually across hundreds of invoices per month is not realistic.

## 6. Buchungsrelevante Version — rules for accounting exports

The posted/not-yet-posted distinction is the most important thing to get right. Treating both cases the same way is precisely how double-counting happens.

### Corrections

- The latest Rechnungskorrektur in the chain is the buchungsrelevante Version (assuming it's validated)
- **Original not yet posted:** the superseded original is excluded from the active booking proposal and the correction is booked directly
- **Original already posted:** the correction must be processed as a separate OPOS-Ausgleich entry that offsets the original — the original booking remains in the ledger per GoBD Unveränderlichkeit; it is not overwritten or suppressed
- All documents remain in the archive, accessible and audit-ready per GoBD

### Cancellations (Storno)

- **Original not yet posted:** the original is excluded from the active booking proposal — the transaction is fully neutralized with no ledger entries
- **Original already posted:** the Storno must be booked as an OPOS-Ausgleich entry that offsets the original; the original booking is not deleted or suppressed
- How the Storno document itself appears in exports depends on Mandant policy:
    - **Option A (more common):** the Storno is excluded from the active booking proposal. Net effect is zero — the transaction is fully neutralized. The Storno document is retained in the GoBD-compliant archive.
    - **Option B:** the Storno appears as a separate line in the export with a "STORNIERT" status and negative amounts, useful for Mandants who want explicit visibility of cancellation activity in their Offene-Posten-Liste.

> **GoBD note:** In both options, the Storno document is **always retained** in the system. "Excluded from the active booking proposal" means it does not appear as an open item for new bookings — it does not mean it is deleted or inaccessible. The complete, immutable Belegkette remains intact.

This has to be configurable per Mandant. A Kanzlei managing 30 Mandanten cannot enforce a single policy across the board. Some Mandants want Stornos entirely neutralized in the export view, others want them visible as negative entries for their own internal controls.

## 7. Detection confidence and audit trail

Not all links are equally reliable. Every linking decision should carry a confidence level:

- **HIGH**: structured XML reference matches an existing invoice by number and supplier
- **MEDIUM**: heuristic match based on supplier + invoice number pattern + amounts
- **LOW**: partial match or reference found only in free text

Low-confidence links should be flagged for manual review rather than applied automatically. Incorrect linking in a Kanzlei workflow can affect a Mandant's Vorsteuerabzug and distort the Offene-Posten-Liste — the confidence level is what tells staff where to focus their review time.

Every linking decision, whether automatic or manual, must be recorded: who linked or unlinked the documents, when, what the previous state was, and which detection method was used. For Kanzlei teams where GoBD compliance and Prüfungsbereitschaft are baseline expectations — not optional extras — this is a core requirement, not a nice-to-have.

## 8. Three features that make this Kanzlei-ready in practice

Getting the data model right is necessary but not sufficient. These three behaviors are what translate the logic above into something a Kanzlei team can actually rely on — including during a Betriebsprüfung.

### Cross-period VAT alert

If an Original invoice was dated in a VAT reporting period that is now closed (say, January) and the Storno arrives in February, the system should flag this immediately. The Kanzlei staff member needs to know they may be required to file a corrected Umsatzsteuervoranmeldung for the prior period — because under § 17 Abs. 1 UStG, the VAT correction obligation applies to the period in which the cancellation took effect, not the current one. Without a system-level alert, this obligation is invisible in a normal processing workflow.

The alert should remain active until an authorized user explicitly confirms they have reviewed the cross-period implication. It should not be dismissable by Mandant users, and the confirmation — including who reviewed it and when — should be stored as part of the audit record.

### Visual Belegketten view

Don't show a flat list of related documents. Render the chain as a directed tree where the relationships are visible at a glance: what canceled what, what replaced what, which document is the current buchungsrelevante Version. The effective document should be visually distinct so a visiting Betriebsprüfer can identify it without needing to understand the system.

Two additional details matter. First, if a document references an invoice that isn't in the system — perhaps the original predates the software adoption — render it as a visible gap in the chain rather than silently ignoring it. An unresolved reference is an audit risk and should look like one. Second, the chain view should be exportable as a static PDF: a printable audit evidence document that a Kanzlei staffer can hand directly to a Betriebsprüfer.

### Auditable manual link confirmation

When a user manually confirms a LOW or MEDIUM confidence link, the system must record the user ID, their role, and a server-side timestamp. Under GoBD, a manual linking decision is a Buchungsentscheidung — an accounting decision — and must be traceable to an identifiable person. It cannot be deleted or retroactively altered.

The UI should enforce this with a two-step confirmation: present both documents side by side, require an acknowledgement that this is being recorded as an accounting decision, and optionally capture a reason. The confirmed link should then be visually distinguishable from automatically detected links in both the chain view and the invoice detail — so an auditor can tell at a glance whether a link was derived from the XML or was a human judgment call.

## How I approached this in RechnungRadar

Getting corrections and cancellations right was one of the trickier parts of building [RechnungRadar](/projects/rechnungradar/). The key design decision was making linking an **orthogonal concern** to validation. A Rechnungskorrektur goes through the same parse-validate-policy pipeline as any other invoice. The chain logic operates alongside it, not instead of it. That way, document role detection, Belegketten-Tracking, and buchungsrelevante Version management stay cleanly separated from syntactic, semantic, and business rule validation — while GoBD-compliant archiving remains non-negotiable at every level.