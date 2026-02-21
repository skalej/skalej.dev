# Normalize Early, Validate Later: Working with Multiple XML Dialects

**Post for:** RechnungRadar company page
**Links to:** https://kaleji.dev/posts/parsing-xrechnung-and-zugferd/

---

You receive data in multiple formats that represent the same thing.

Two XML dialects for the same invoice. HL7 and FHIR for the same medical record. SWIFT MT and ISO 20022 for the same payment. Different versions of the same EDI message.

Where in your pipeline do you deal with the differences?

The naive approach: format-specific branches in every layer. Validation has two code paths. Exports have two code paths. API responses have two code paths. Every new format multiplies the branches.

The cost isn't just duplication — it's behavioral inconsistency. A rule with two code paths will eventually have a bug in one that the other doesn't. The difference in code is immediate:

Without normalization:
  if (format == UBL) extractFromUbl(...) else extractFromCii(...)
  // ...repeated in every rule, every export, every report

With normalization:
  if (invoice.supplierVatId == null) → finding
  // one path, format-agnostic

The pattern that works: **normalize at the boundary.**

→ Each format gets its own extractor (mechanical translation, no business logic)
→ All extractors produce one normalized model
→ Everything downstream — rules, policies, exports — sees one structure
→ Adding a new format = writing one new extractor

Key design choices:
- Make every field optional (extraction is not validation)
- Keep the model flat enough that rules don't need deep traversal
- Separate three concerns: structural validation → tolerant extraction → strict business validation

The post also covers where this breaks down (lossy normalization, format-specific semantics) and how it connects to deterministic evaluation:

https://kaleji.dev/posts/parsing-xrechnung-and-zugferd/

#SoftwareArchitecture #DataNormalization #BackendEngineering #XMLParsing #SystemDesign #EInvoicing #RechnungRadar
