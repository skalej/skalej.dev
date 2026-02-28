---
title: "RechnungRadar"
description: "Pre-validation & compliance checks for structured e-invoices (XRechnung/ZUGFeRD), designed to reduce manual clarification loops in Kanzlei and SME workflows."
descriptionDe: "Vorvalidierung & Compliance-Prüfung für E-Rechnungen (XRechnung/ZUGFeRD). Erkennt fehlende Pflichtfelder, Vertragsabweichungen und IBAN-Änderungen — bevor die Rechnung ins ERP geht. Für Kanzleien und Mittelstand."
pubDatetime: 2026-01-20T00:00:00Z
draft: false
techStack:
  - "Kotlin"
  - "Spring Boot 3 (REST API)"
  - Spring events
  - "PostgreSQL"
  - "Flyway"
  - "S3-compatible object storage / MinIO"
  - "Docker"
liveUrl: ""
githubUrl: ""
image: ../../assets/images/rechnungradar.png
logo: ../../assets/images/rechnungradar-icon.jpg
keywords:
  - "XRechnung validation"
  - "ZUGFeRD validation"
  - "e-invoice validation tool"
  - "German e-invoicing"
  - "XRechnung compliance check"
  - "invoice pre-validation"
  - "Kanzlei invoice automation"
  - "structured invoice validation"
  - "XRechnung Prüfung"
  - "ZUGFeRD Validierung"
  - "E-Rechnung prüfen"
  - "Rechnungsprüfung automatisieren"
  - "XRechnung Pflichtfelder prüfen"
  - "E-Rechnung Vorvalidierung"
  - "Kanzlei Rechnungseingang"
  - "Eingangsrechnungen prüfen"
  - "DATEV Vorprüfung"
  - "Rechnungskontrolle Mittelstand"
  - "Buchhaltung Automatisierung"
  - "Storno Rechnung Verkettung"
---

RechnungRadar is a pre-validation gateway for inbound German e-invoices (XRechnung and ZUGFeRD).

It closes **the gap between _technical validity_ and _operational readiness_** by checking whether an invoice that passes XML/schema validation is actually process-ready for accounting systems.

## What it does

- Validates XRechnung (UBL + CII) and ZUGFeRD (PDF with embedded XML)
- Applies deterministic, versioned compliance rule packs
- Enforces organization- or mandant-specific buyer policies
- Runs contract-to-invoice compliance checks (payment terms, recurring amounts, validity windows)
- Detects and links correction invoices and storno (cancellation) documents into auditable chains
- Provides human-readable findings with evidence and suggested fixes
- Generates supplier-ready correction explanations
- Manages a vendor master with identity matching and IBAN change detection
- Stores originals, normalized data, and full audit trail
- Works independently — no mandatory ERP integration required

## Why it matters

Many invoices are technically valid but still fail during booking due to missing references, internal policy violations, or contract mismatches. Kanzlei offices processing invoices for dozens of mandants face this at scale — every rejected invoice means another clarification loop with the supplier.

RechnungRadar catches these issues before ERP ingestion, reducing manual rework and improving invoice quality over time. It acts as a reliable control layer between invoice receipt and downstream accounting.

## How it works

Every uploaded invoice passes through a multi-stage pipeline:

1. **Intake & deduplication** — files are stored with content-hash based idempotency. ZUGFeRD PDFs have their embedded XML extracted automatically.
2. **Parsing & normalization** — streaming XML parsing (StAX) extracts invoice fields into a normalized model, supporting both UBL and CII profiles.
3. **Standards validation** — deterministic rule packs check structural integrity, mandatory fields, VAT arithmetic, and breakdown consistency. Every rule has a stable code (e.g. `RR-TOT-001`) and version.
4. **Buyer policy checks** — organization-specific requirements like mandatory PO numbers, buyer references, or cost center fields are enforced per tenant or mandant.
5. **Contract compliance** — if a vendor contract is linked, the system checks payment terms, recurring fee deviations, contract validity windows, and one-time fee repetition.
6. **Correction & storno linking** — correction and cancellation documents are detected and linked to their originals, maintaining document chains with effective-version tracking for clean accounting exports.
7. **Vendor matching** — invoice supplier identifiers are matched against the vendor master using VAT ID, IBAN, and fuzzy name matching, with anomaly detection for IBAN changes.

All processing is async, retryable, and auditable. The same input with the same rule version always produces the same findings.

## Who it's for

- **Kanzlei offices (Steuerberater / Buchhaltungsbüros)** managing e-invoice intake for multiple mandants — with per-mandant policies, vendor masters, and batch export workflows
- **Small and mid-sized companies (Mittelstand)** that need invoice validation and internal controls before DATEV or ERP posting
- **AP teams** looking for a pre-accounting control plane that enforces buyer policies, contract terms, and vendor identity checks without replacing their existing accounting software

## FAQ

### What invoice formats does RechnungRadar support?

RechnungRadar validates **XRechnung XML** (both UBL and CII variants) and **ZUGFeRD PDF/A-3** invoices with embedded XML. These are the two standard e-invoice formats used in Germany and the EU.

### Does RechnungRadar replace DATEV or my ERP system?

No. RechnungRadar is a **pre-accounting validation layer**. It checks invoices before they reach your ERP or DATEV, catching issues that would otherwise require manual correction after booking. It complements your existing accounting workflow.

### What kinds of errors does it detect?

Beyond XML schema validation, RechnungRadar checks for missing mandatory fields, VAT arithmetic mismatches, missing buyer references or PO numbers, contract compliance issues (wrong payment terms, expired contracts, recurring amount anomalies), and vendor identity problems like unexpected IBAN changes.

### Can it handle correction invoices and cancellations (Storno)?

Yes. RechnungRadar detects correction and storno documents, links them to original invoices, and maintains document chains. Accounting exports only include the effective version — superseded and canceled originals are excluded to prevent double-counting.

### Is it suitable for Kanzlei workflows with multiple clients?

Yes. RechnungRadar supports multi-mandant setups where each mandant has isolated vendor masters, buyer policies, and contract configurations. Kanzlei staff can process invoices across mandants with batch operations and per-mandant exports.
