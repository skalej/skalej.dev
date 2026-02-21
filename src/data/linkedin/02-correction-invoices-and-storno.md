# Correction Invoices and Storno in German E-Invoicing

**Post for:** RechnungRadar company page
**Links to:** https://kaleji.dev/posts/correction-invoices-and-storno-in-german-e-invoicing/

---

A supplier sends three documents over two months:

→ Original invoice: 5.000 EUR
→ Storno (cancellation): -5.000 EUR
→ New corrected invoice: 4.800 EUR

The correct accounting outcome: 4.800 EUR in the books. But without chain awareness, your export may show 9.800 EUR — or worse.

This is the double-counting problem — and it happens more often than you'd think, especially in Kanzlei offices processing hundreds of invoices per month across multiple mandants.

Corrections (Rechnungskorrekturen) and Stornos (Stornierungen) need to be:

→ Detected: is this document an original, correction, or cancellation?
→ Linked: which original does it reference?
→ Tracked: only the effective version should appear in accounting exports
→ Auditable: every linking decision must be traceable

The challenge: not all invoices carry clean references. Some ERP systems omit them. Some put the reference in free text instead of structured fields. Your system needs a fallback strategy — from structured XML references to heuristic matching to manual review.

We wrote a detailed post covering how document chains work, what "effective version" means for accounting, and how Kanzlei offices can handle this reliably.

Read the full post: https://kaleji.dev/posts/correction-invoices-and-storno-in-german-e-invoicing/

#XRechnung #ZUGFeRD #Storno #Rechnungskorrektur #EInvoicing #ERechnung #Kanzlei #Buchhaltung #DATEV #InvoiceProcessing #RechnungRadar
