# How XRechnung Validation Works in Germany

**Post for:** RechnungRadar company page
**Links to:** https://kaleji.dev/posts/how-xrechnung-validation-works-in-germany/

---

Most people think validating an XRechnung means checking if the XML is well-formed.

It's not that simple.

In practice, there are three layers where invoices fail:

1. **Structural** — wrong namespace, missing root element, no embedded XML in a ZUGFeRD PDF
2. **Field-level** — missing buyer name, VAT breakdown sums that don't add up, due date before issue date
3. **Business rules** — missing Leitweg-ID, no PO reference, vendor IBAN changed since last invoice

The catch: most real-world rejections happen at layer 3. These invoices pass schema validation perfectly — and then bounce during booking.

Public validators like the KoSIT validator check schema conformance — but they don't know your buyer policies, vendor relationships, or contract terms. The gap between "schema-valid" and "process-ready" is where most Kanzlei operational work happens.

For offices processing invoices across dozens of mandants, every rejected invoice means another clarification loop. And those loops add up fast.

We wrote a deep dive on how XRechnung and ZUGFeRD validation actually works, what public validators miss, and why schema validation alone isn't enough.

Read the full post: https://kaleji.dev/posts/how-xrechnung-validation-works-in-germany/

#XRechnung #ZUGFeRD #EInvoicing #ERechnung #InvoiceValidation #GermanAccounting #Kanzlei #Buchhaltung #EN16931 #Digitalisierung #RechnungRadar
