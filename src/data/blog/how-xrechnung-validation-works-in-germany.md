---
title: "How XRechnung Validation Works in Germany"
description: "What 'valid' actually means for XRechnung and ZUGFeRD invoices, why schema-compliant invoices still get rejected, and the three layers of validation that matter."
pubDatetime: 2026-01-19T10:30:00Z
draft: false
tags:
  - "xrechnung"
  - "e-invoicing"
  - "validation"
  - "germany"
---

You run an invoice through the KoSIT validator, it comes back clean, you forward it to accounting, and three days later it bounces back. Missing buyer reference. No purchase order number. The vendor's IBAN doesn't match what's in the master data. The invoice was technically valid the whole time. It just wasn't ready to be booked.

This keeps happening because "valid" means different things at different layers. Schema validation is only the first check, and most rejections happen further down.

## Table of contents

## What is XRechnung?

XRechnung is Germany's national take on the European e-invoicing standard EN 16931. It adds business rules on top of two XML syntaxes:

- **UBL (Universal Business Language)**, the more common one internationally
- **CII (Cross Industry Invoice)**, the UN/CEFACT syntax you see a lot in German and French systems

Both carry the same content (invoice number, dates, parties, totals, VAT breakdowns) but use completely different XML structures and namespaces. A validator needs to handle both.

**ZUGFeRD** is a related format: a PDF/A-3 with embedded XML. The XML inside is either UBL or CII, so once you extract it, the same validation logic applies.

## Three kinds of validation

Most people think of validation as "does the XML parse?" But there are actually three distinct layers where an invoice can fail.

### Structural validity

The XML must be well-formed with the correct root element and namespaces. UBL uses `urn:oasis:names:specification:ubl:schema:xsd:Invoice-2`, CII uses `urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100`. Get this wrong and the document isn't recognized as an e-invoice at all.

For ZUGFeRD, there's an extra step: the XML must actually be embedded in the PDF. Scanned PDFs without embedded XML are a surprisingly common source of confusion.

### Field-level and arithmetic checks

Even with valid structure, invoices frequently trip on:

- **Missing mandatory fields.** Invoice number, issue date, currency code, supplier name, buyer name are all required. Buyer name is the one I see omitted most often.
- **VAT arithmetic.** The sum of VAT breakdown amounts must match the declared total. Rounding differences across line items cause mismatches constantly, especially with multiple tax rates.
- **VAT breakdown consistency.** Non-zero VAT total without a breakdown by rate. Smaller ERP systems generating CII invoices are the usual culprit.
- **Date consistency.** A due date before the issue date passes schema validation but flags a data quality problem.

### Business and policy checks

This is where most real-world rejections actually happen. An invoice can be structurally valid and arithmetically correct but still fail during booking:

- A **buyer reference** (Leitweg-ID for public sector, or an internal reference for corporate buyers) is missing
- No **purchase order number**
- The invoice references a **vendor that's not in the buyer's master data**, or the vendor's IBAN changed since the last invoice
- **Payment terms** don't match what's in the contract
- The amount deviates from a **recurring contract fee** without explanation

These aren't XRechnung schema errors. They're operational readiness problems that cause invoices to bounce between accounting, procurement, and suppliers for weeks.

## The errors that keep showing up

Based on the XRechnung specification and common ERP output patterns, certain errors appear over and over:

| Error | Frequency | Impact |
|-------|-----------|--------|
| Missing buyer reference | Very common | Blocks public-sector processing entirely |
| VAT breakdown sum mismatch | Common | Accounting system rejects the invoice |
| Missing supplier VAT ID | Occasional | Cannot match to vendor master |
| Due date before issue date | Occasional | Data quality flag |
| Wrong currency code format | Rare | Parse failure |

The high-frequency errors are almost never caught by schema validation. They need field-level and policy-level checks.

## What public validators miss

Germany provides public validation tools (the KoSIT validator being the main one) that check XRechnung conformance against the official Schematron rules. These are genuinely useful for catching structural and schema-level issues.

But they stop at technical conformance. They answer "is this a valid XRechnung?" not "is this invoice ready for our accounting workflow?" The gap between those two questions is where most operational problems live.

**Buyer references and PO numbers.** Public validators don't know your organization's policies. A missing Leitweg-ID won't trigger a schema finding, but it will block processing in your accounting system.

**Vendor identity.** Is this supplier in your vendor master? Has their IBAN changed? Schema validation has no concept of vendor matching.

**Contract terms.** Does the invoiced amount match the agreed recurring fee? Are payment terms consistent with the contract? Entirely outside the scope of e-invoice standards.

**Correction and storno chains.** If a correction invoice supersedes an original, the public validator treats both as independent valid documents. It won't tell you that the original should no longer appear in your books.

**Cross-invoice context.** Has this exact invoice been uploaded before? Is the same setup fee being charged a second time? Schema validation sees each invoice in isolation.

For a Kanzlei processing invoices across dozens of mandants, each with their own policies, vendor relationships, and contracts, this gap between "schema-valid" and "process-ready" is where the real work happens.

## Why deterministic validation matters

When you're a Kanzlei processing invoices for dozens of mandants, validation has to be deterministic: the same invoice with the same rules must always produce the same findings. Audit trails require reproducibility. Re-processing an invoice after a rule update should produce explainably different results, not random variation. Batch operations across mandants have to be consistent.

This means validation rules need to be versioned. When a rule is added or changed, the version increments, and each invoice records which rule version was applied. Re-processing uses the new version and creates a new evaluation while the old one stays intact for audit.

## Schema validation is necessary but not sufficient

XRechnung/ZUGFeRD schema validation catches structural problems, but most invoice rejections in real workflows come from missing references, policy violations, or commercial mismatches that schema validation never touches.

A practical validation system needs all three layers (structural, field-level arithmetic, and business/policy checks) applied deterministically, with clear evidence for every finding. I built [RechnungRadar](/projects/rechnungradar/) around this idea: run the full pipeline on every incoming invoice, produce actionable findings before anything reaches DATEV or an ERP system, and make clarification loops happen once instead of repeatedly.
