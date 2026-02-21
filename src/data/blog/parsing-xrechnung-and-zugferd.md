---
title: "Normalize Early, Validate Later: Working with Multiple XML Dialects"
description: "A pattern for systems that ingest multiple document formats representing the same data — why normalizing into a single model early in the pipeline simplifies everything downstream."
pubDatetime: 2026-02-13T00:00:00Z
draft: false
tags:
  - "architecture"
  - "xml-parsing"
  - "data-normalization"
  - "kotlin"
  - "e-invoicing"
---

A common problem in backend systems: you receive data in multiple formats that represent the same thing. Two XML dialects for the same invoice standard. HL7 v2 and FHIR for the same medical record. SWIFT MT and ISO 20022 for the same payment instruction. Different versions of the same EDI message.

Each format has different element names, different structures, different quirks — but the business-relevant content is the same. The question is: where in your pipeline do you deal with the differences?

I hit this while building [RechnungRadar](/projects/rechnungradar/), which ingests German e-invoices in two XML syntaxes (UBL and CII) plus a PDF-with-embedded-XML format (ZUGFeRD). This post covers the pattern that worked best: **normalize early, validate later.**

## Table of contents

## The problem with format-aware logic

The naive approach is to write format-specific code throughout the system. Your validation rules check UBL fields in one branch and CII fields in another. Your export logic has two code paths. Your API serialization handles both structures.

This works at first. Then you add a third format. Or a rule that needs fields from four different locations in UBL but three in CII. Or a policy check that combines parsed data with tenant configuration. Every layer multiplies the format-specific branches, and each branch is a place where behavior can diverge.

The cost isn't just code duplication — it's **behavioral inconsistency.** A validation rule that checks "is the supplier VAT ID present?" should not care whether the input was UBL or CII. If the rule has two code paths, one of them will eventually have a bug that the other doesn't, and you'll get different findings for the same business data depending on which format it arrived in.

The difference is stark in code. Without normalization, every rule looks like this:

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

With normalization, the same rule becomes:

```kotlin
// Format-agnostic rule — simple, testable, one code path
fun checkVatId(invoice: NormalizedInvoice): Finding? {
    return if (invoice.supplierVatId.isNullOrBlank()) Finding("Missing supplier VAT ID") else null
}
```

One code path. One set of tests. One set of bugs. The format-specific complexity is pushed to the extractor, where it belongs.

## The pattern: normalize at the boundary

The fix is to normalize as early as possible — ideally right after parsing, before any business logic runs.

Each input format gets its own **extractor**: a module that knows one format's structure and maps it to a single internal model. The extractor's job is mechanical translation, not interpretation. It doesn't decide if a field is valid or missing — it just maps whatever is present.

```
Input (UBL XML)  → UBL Extractor  → Normalized Model
Input (CII XML)  → CII Extractor  → Normalized Model  → Rules, policies, exports...
Input (PDF+XML)  → PDF Extractor → (delegates to UBL or CII extractor)
```

Everything downstream operates on the normalized model. Rules, policies, exports, API responses, reports — one code path, one set of tests, one set of bugs.

## What the normalized model should look like

Two design choices matter:

### Make every field optional

Real-world documents are incomplete. A CII invoice might omit the buyer name. A UBL invoice might have a due date in one location but not another. If your normalized model requires fields, the extractor has to decide what to do when they're missing — and that's a validation decision, not an extraction decision.

Instead, make every field nullable. Let the extractor populate what it can. Let a downstream validation rule produce a finding like "buyer name is missing." This keeps the boundary between extraction and validation clean.

### Keep it flat (enough)

Normalized models tend to grow complex hierarchies that mirror the source format's structure. Resist this. The model should contain the **business-relevant fields** at a reasonable depth — not a 1:1 mapping of the XML tree.

For example, an invoice has a supplier name, a buyer name, totals, tax breakdowns, dates, and references. These can live as top-level fields or one level deep. You don't need to preserve the source format's nesting of `AccountingSupplierParty > Party > PartyName > Name` as four levels of objects in your model.

The flatter the model, the simpler the rules that consume it. If a rule needs `supplierName`, it should be `invoice.supplierName`, not `invoice.parties.supplier.legalEntity.name`.

## Three layers, not two

It's tempting to think of parsing and validation as a single step: "parse the document and check if it's valid." But there are actually three distinct concerns, and separating them matters:

**Structural validation** — is this a well-formed XML document with the right root element and namespace? This can and should happen before extraction. If the document isn't structurally sound, there's nothing to extract. Rejecting here is correct.

**Tolerant extraction** — given a structurally valid document, pull out every business-relevant field you can find. Be tolerant of real-world variation: extra whitespace in numeric fields, slightly non-standard date formats, unexpected namespace prefixes with correct URIs. If a field is present and parseable, extract it. If it's genuinely garbled, record an extraction error for that field and continue with the rest.

**Business validation** — given the extracted data, decide what's acceptable. Is the VAT ID present? Do the totals add up? Is the buyer reference required by policy? This is where strictness belongs.

The key insight: **extraction should be tolerant, validation should be strict, and they should be separate.** Mixing them creates extractors that reject too much (refusing to process an invoice because a non-critical field has unexpected formatting) and validators that trust too much (assuming extracted data is complete because the extractor didn't report errors).

This is why the "validate later" part of the pattern matters. The extractor's job is to give the validator the best data it can. The validator's job is to decide what's acceptable. Clean separation makes both easier to test and evolve independently.

## Where this pattern breaks down

**Lossy normalization.** If your normalized model drops information that downstream logic turns out to need, you have to either enrich the model or add format-specific access paths. This is why starting with a slightly broader model than you think you need is better than starting minimal and patching.

**Format-specific semantics.** Sometimes the same field means slightly different things in different formats. A "due date" in one format might be the stated payment date; in another, it might be calculated from payment terms. If your normalized model has a single `dueDate` field, you lose the distinction. Whether this matters depends on your domain — in most cases it doesn't, but in some (financial reconciliation, regulatory reporting) it might.

**Performance.** Normalizing adds a processing step. For most document sizes this is negligible, but if you're processing millions of small messages per second, the allocation cost of the intermediate model matters. In those cases, you might normalize lazily (on field access) rather than eagerly (full model upfront).

## The payoff

The biggest benefit isn't code reduction — it's **confidence.** When every rule, every export, and every report operates on the same model, you can test them with format-agnostic fixtures. You know that a finding produced from a UBL invoice will also be produced from a CII invoice containing the same data, because the rule doesn't know the difference.

When you add a new format later (and you will), you write one new extractor. Everything else works automatically.

When investigating a bug ("this invoice should have flagged X but didn't"), you can reproduce it by constructing the normalized model directly — you don't need a fixture in every supported format.

The pattern is simple: push format-specific complexity to the edge, normalize at the boundary, and keep everything downstream format-agnostic. The earlier you normalize, the less of your system you have to maintain in `N` variants.

This pattern also pairs well with [deterministic evaluation](/posts/building-a-deterministic-invoice-validation-pipeline-in-kotlin/). When all rules operate on one model, versioning the rule engine becomes straightforward — you're versioning rules against a single input shape, not against N format-specific shapes. Normalization simplifies determinism, and determinism requires normalization to stay manageable.
