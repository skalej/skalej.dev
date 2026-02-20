---
title: "RechnungRadar"
description: "Pre-validation & compliance checks for structured e-invoices (XRechnung/ZUGFeRD), designed to reduce manual clarification loops in Kanzlei and SME workflows."
pubDatetime: 2026-02-17T00:00:00Z
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
keywords:
  - "XRechnung validation"
  - "ZUGFeRD validation"
  - "e-invoice validation tool"
  - "German e-invoicing"
  - "XRechnung compliance check"
  - "invoice pre-validation"
  - "Kanzlei invoice automation"
  - "structured invoice validation"
---

RechnungRadar is a pre-validation gateway for inbound German e-invoices (XRechnung and ZUGFeRD).

It closes **the gap between *technical validity* and *operational readiness*** by checking whether an invoice that passes XML/schema validation is actually process-ready for accounting systems.

## What it does

- Validates XRechnung (XML) and ZUGFeRD (PDF with embedded XML)
- Applies deterministic, versioned rule packs
- Enforces organization- or mandant-specific requirements
- Provides human-readable findings with evidence and suggested fixes
- Generates supplier-ready correction explanations
- Stores originals, normalized data, and audit trail
- Works without mandatory ERP integration

## Why it matters

Many invoices are technically valid but still fail during booking due to missing references, internal policies, or contract constraints. RechnungRadar detects these issues before ERP ingestion, reducing manual clarification loops and improving invoice quality over time.

RechnungRadar acts as a reliable validation layer — protecting downstream accounting systems from preventable invoice errors.

