---
title: "Normalize Early, Validate Later: Working with Multiple XML Dialects"
description: "Why normalizing multiple document formats into a single model at the boundary of your system simplifies everything downstream, from validation rules to testing to adding new formats."
pubDatetime: 2026-02-11T18:20:00Z
draft: false
tags:
  - "architecture"
  - "xml-parsing"
  - "data-normalization"
  - "kotlin"
  - "e-invoicing"
---

You receive data in multiple formats that represent the same thing. Two XML dialects for the same invoice standard. HL7 v2 and FHIR for the same medical record. SWIFT MT and ISO 20022 for the same payment instruction. Different element names, different structures, different quirks, but the business content is the same.

The question is: where in your pipeline do you deal with the differences?

## Table of contents

## Format-aware logic doesn't scale

The naive approach: write format-specific code throughout the system. Your validation rules check UBL fields in one branch and CII fields in another. Export logic has two code paths. API serialization handles both structures.

Works at first. Then you add a third format. Or a rule that needs fields from four different locations in UBL but three in CII. Or a policy check that combines parsed data with tenant configuration. Every layer multiplies the format-specific branches.

The real cost isn't code duplication, it's **behavioral inconsistency.** A validation rule checking "is the supplier VAT ID present?" should not care whether the input was UBL or CII. With two code paths, one of them will eventually have a bug the other doesn't. You get different findings for the same business data depending on which format it arrived in.

The difference is stark in code. Without normalization:

```kotlin
// Format-aware rule — fragile, duplicated, drift-prone
fun checkVatId(doc: Document): Finding? {
    val vatId = if (doc.format == UBL) {
        doc.xpath("//cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID")
    } else {
        doc.xpath("//ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID")
    }
    return if (vatId.isNullOrBlank()) Finding("Missing supplier VAT ID") else null
}
```

With normalization:

```kotlin
// Format-agnostic rule — simple, testable, one code path
fun checkVatId(invoice: NormalizedInvoice): Finding? {
    return if (invoice.supplierVatId.isNullOrBlank()) Finding("Missing supplier VAT ID") else null
}
```

One code path. One set of tests. One set of bugs. Format-specific complexity is pushed to the extractor, where it belongs.

## Normalize at the boundary

The fix: normalize as early as possible, right after parsing, before any business logic runs.

Each input format gets its own **extractor**, a module that knows one format's structure and maps it to a single internal model. The extractor's job is mechanical translation, not interpretation. It doesn't decide if a field is valid or missing. It just maps whatever is present.

```
Input (UBL XML)  → UBL Extractor  → Normalized Model
Input (CII XML)  → CII Extractor  → Normalized Model  → Rules, policies, exports...
Input (PDF+XML)  → PDF Extractor → (delegates to UBL or CII extractor)
```

Everything downstream operates on the normalized model. Rules, policies, exports, API responses, reports. One code path, one set of tests.

I hit this problem while building [RechnungRadar](/projects/rechnungradar/), which ingests German e-invoices in UBL, CII, and ZUGFeRD (PDF with embedded XML). Early on, I had format-specific branches creeping into the validation rules, and it became clear that approach wouldn't hold up. Normalizing at the boundary cleaned things up significantly.

## Designing the normalized model

Two design choices that matter:

### Make every field optional

Real-world documents are incomplete. A CII invoice might omit the buyer name. A UBL invoice might have a due date in one location but not another. If your normalized model requires fields, the extractor has to decide what to do when they're missing, and that's a validation decision, not an extraction decision.

Make every field nullable. Let the extractor populate what it can. Let a downstream validation rule produce a finding like "buyer name is missing." Keeps the boundary between extraction and validation clean.

### Keep it flat enough

Normalized models tend to grow complex hierarchies that mirror the source format. Resist this. The model should contain business-relevant fields at a reasonable depth, not a 1:1 mapping of the XML tree.

An invoice has a supplier name, buyer name, totals, tax breakdowns, dates, references. These can live as top-level fields or one level deep. You don't need to preserve the source format's nesting of `AccountingSupplierParty > Party > PartyName > Name` as four levels of objects.

The flatter the model, the simpler the rules that consume it. `invoice.supplierName` beats `invoice.parties.supplier.legalEntity.name`.

## Three layers, not two

It's tempting to think of parsing and validation as one step ("parse the document and check if it's valid"). There are actually three distinct concerns:

**Structural validation.** Is this well-formed XML with the right root element and namespace? This should happen before extraction. If the document isn't structurally sound, there's nothing to extract.

**Tolerant extraction.** Given a structurally valid document, pull out every business-relevant field you can. Be tolerant of real-world messiness: extra whitespace in numeric fields, slightly non-standard date formats, unexpected namespace prefixes with correct URIs. If a field is present and parseable, extract it. If it's genuinely garbled, record an extraction error for that field and continue with the rest.

**Business validation.** Given the extracted data, decide what's acceptable. Is the VAT ID present? Do the totals add up? Is the buyer reference required by policy? Strictness belongs here.

The key insight: **extraction should be tolerant, validation should be strict, and they should be separate.** Mixing them creates extractors that reject too much (refusing to process an invoice because a non-critical field has unexpected formatting) and validators that trust too much (assuming extracted data is complete because the extractor didn't report errors).

## Where this breaks down

**Lossy normalization.** If your normalized model drops information that downstream logic turns out to need, you have to either enrich the model or add format-specific access paths. Starting with a slightly broader model than you think you need is better than starting minimal and patching.

**Format-specific semantics.** Sometimes the same field means slightly different things across formats. A "due date" in one format might be the stated payment date; in another, it might be calculated from payment terms. A single `dueDate` field loses the distinction. Whether this matters depends on your domain. For most invoice processing it doesn't. For financial reconciliation or regulatory reporting, it might.

**Performance.** Normalizing adds a processing step. For typical document sizes this is negligible. If you're processing millions of small messages per second, the allocation cost of the intermediate model matters, and you might normalize lazily (on field access) rather than eagerly.

## Why it's worth it

The biggest benefit isn't code reduction. It's confidence. When every rule, export, and report operates on the same model, you can test them with format-agnostic fixtures. You know a finding produced from a UBL invoice will also be produced from a CII invoice containing the same data, because the rule doesn't know the difference.

When you add a new format (and you will), you write one new extractor. Everything else works automatically.

When investigating a bug ("this invoice should have flagged X but didn't"), you reproduce it by constructing the normalized model directly. No need for a fixture in every supported format.

Push format-specific complexity to the edge, normalize at the boundary, keep everything downstream format-agnostic. This pattern also pairs well with [deterministic evaluation](/posts/building-a-deterministic-invoice-validation-pipeline-in-kotlin/): when all rules operate on one model, versioning the rule engine becomes straightforward because you're versioning rules against a single input shape, not N format-specific shapes.
