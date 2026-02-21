---
title: "Parsing XRechnung and ZUGFeRD: UBL, CII, and Embedded XML Extraction"
description: "A practical guide to parsing XRechnung (UBL and CII) and ZUGFeRD invoices — format detection, StAX streaming, PDF XML extraction, and normalizing into a common model."
pubDatetime: 2026-02-13T00:00:00Z
draft: false
tags:
  - "xrechnung"
  - "zugferd"
  - "xml-parsing"
  - "kotlin"
  - "e-invoicing"
---

If you're building a system that processes German e-invoices, the first problem you hit is parsing. XRechnung comes in two XML syntaxes (UBL and CII) with different structures, namespaces, and field paths. ZUGFeRD is a PDF with XML embedded inside it. And real-world invoices don't always follow the spec cleanly.

This post covers the practical approach I used in [RechnungRadar](/projects/rechnungradar/) — format detection, XML extraction from PDFs, streaming parsing, and normalizing everything into a single model.

## Table of contents

## The format landscape

German e-invoices use two formats, both implementing EN 16931:

**XRechnung XML** — a pure XML document in one of two syntaxes:
- **UBL** (Universal Business Language) — root element `Invoice` in the `urn:oasis:names:specification:ubl:schema:xsd:Invoice-2` namespace
- **CII** (Cross Industry Invoice) — root element `CrossIndustryInvoice` in the `urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100` namespace

**ZUGFeRD** — a PDF/A-3 document with an XML file embedded as an attachment. The embedded XML is either UBL or CII. ZUGFeRD is what most German businesses encounter in practice, since it's both human-readable (the PDF) and machine-readable (the embedded XML).

## Step 1: Detecting the format

Before parsing, you need to know what you're dealing with. The detection strategy:

1. **Check the content type and magic bytes.** PDFs start with `%PDF`. XML files start with `<?xml` or directly with a root element.
2. **For PDFs:** attempt to extract an embedded XML attachment. If found and parseable, it's ZUGFeRD. If not, it's either a scanned PDF or a non-e-invoice PDF.
3. **For XML:** read the root element and namespace to determine UBL vs CII.

Magic-byte sniffing is important because you can't trust the content type sent by the client. A file uploaded as `application/pdf` might actually be XML, or vice versa.

## Step 2: Extracting XML from ZUGFeRD PDFs

ZUGFeRD embeds the XML as a PDF attachment (technically an "associated file" in the PDF/A-3 structure). Extracting it requires a PDF library that supports embedded files.

With **Apache PDFBox 3.x**, the approach is:

1. Load the PDF document
2. Access the document catalog's names dictionary
3. Look for embedded file specifications — ZUGFeRD typically names the attachment `factur-x.xml`, `xrechnung.xml`, or `ZUGFeRD-invoice.xml`
4. Extract the embedded file stream
5. Parse the resulting XML as UBL or CII

The tricky part: not all ZUGFeRD PDFs name the attachment consistently. Some use non-standard names. A robust implementation should enumerate all embedded files and attempt to parse each as an invoice, rather than relying on a specific filename.

If no parseable XML is found inside a PDF, the document is not a structured e-invoice. It might be a scanned invoice or a regular PDF — this should be flagged as `UNSUPPORTED` rather than silently failing.

## Step 3: Streaming XML parsing with StAX

For the actual XML parsing, I chose **StAX (Streaming API for XML)** over DOM for a few reasons:

- **Memory efficiency** — invoices are typically small (10-500 KB), but the system processes them in batches. Streaming avoids loading full DOM trees into memory.
- **Speed** — StAX is faster than DOM for targeted extraction where you know which elements you need.
- **Control** — you process elements as you encounter them, which makes it easy to bail out early on malformed documents.

The implementation uses **Woodstox** as the StAX provider (faster and more spec-compliant than the JDK default).

The parsing logic is split into two extractors:

- `UblExtractor` — knows UBL element paths (`/Invoice/AccountingSupplierParty/Party/PartyName/Name`, etc.)
- `CiiExtractor` — knows CII element paths (`/CrossIndustryInvoice/SupplyChainTradeTransaction/ApplicableHeaderTradeAgreement/SellerTradeParty/Name`, etc.)

Both produce the same output: a `NormalizedInvoice`.

## Step 4: The normalized invoice model

This is the key design decision. Instead of working with UBL and CII structures throughout the codebase, everything downstream operates on a single normalized model:

```kotlin
data class NormalizedInvoice(
    val invoiceNumber: String?,
    val issueDate: LocalDate?,
    val dueDate: LocalDate?,
    val currencyCode: String?,
    val supplierName: String?,
    val supplierVatId: String?,
    val buyerName: String?,
    val buyerReference: String?,
    val purchaseOrderReference: String?,
    val netTotal: BigDecimal?,
    val vatTotal: BigDecimal?,
    val grossTotal: BigDecimal?,
    val vatBreakdowns: List<VatBreakdown>,
    // ... additional fields
)
```

Every field is nullable, because real-world invoices may omit any of them. Validation rules check for missing fields explicitly and produce findings — the parser itself is tolerant.

This means the parser's job is **extraction, not validation**. It pulls out whatever is available and leaves the quality judgment to the rule engine. This separation keeps the parser simple and testable.

## Tolerant parsing in practice

Real-world e-invoices are messy. Some things I've encountered:

- **Missing namespaces** — some generators omit namespace declarations or use non-standard prefixes. The parser normalizes namespace handling rather than failing on prefix mismatches.
- **Extra whitespace in numeric fields** — amounts like `" 1234.56 "` need trimming before parsing to `BigDecimal`.
- **Date format variations** — most invoices use `YYYY-MM-DD`, but some use other ISO 8601 variants. The parser handles common variations.
- **Duplicate fields** — some CII invoices include the same field in multiple locations (e.g., seller name in both the agreement and delivery sections). The parser uses a defined priority order.

The principle is: **extract what you can, flag what's wrong, never crash on unexpected input.** An unparseable invoice should produce a `PARSED_FAILED` status with a clear error, not a 500 error in the API.

## Testing with real-world fixtures

Parsing logic needs extensive fixture-based testing. The test suite includes:

- Standard-compliant XRechnung UBL and CII samples
- ZUGFeRD PDFs from different generators
- Edge cases: missing fields, extra namespaces, non-standard attachments
- Intentionally malformed documents to verify error handling

Each fixture has an expected `NormalizedInvoice` output. Tests assert field-by-field equality, which catches regressions when the extractor logic changes.

## Lessons learned

**Don't validate during parsing.** It's tempting to reject documents early if a required field is missing. But separating extraction from validation makes both easier to test and evolve independently.

**Normalize early.** The sooner you get to a single model, the less format-specific code you carry through the system. Every rule, policy check, export, and API response works with `NormalizedInvoice` — never with raw XML structures.

**Real invoices are the best test data.** Synthetic test fixtures are useful for unit tests, but the bugs that matter are found in actual invoices from real ERP systems. Every new weird invoice that shows up becomes a new test fixture.
