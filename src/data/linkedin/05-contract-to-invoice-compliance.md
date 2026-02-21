# Contract-to-Invoice Compliance: Catching Mismatches Before Booking

**Post for:** RechnungRadar company page
**Links to:** https://kaleji.dev/posts/contract-to-invoice-compliance/

---

Your SaaS vendor contract says 500 EUR/month, Net 30.

This month's invoice: 575 EUR, Net 14.

Schema validation? Passes.
Buyer policy? Passes.
Contract compliance? That's where it gets caught.

This is the gap between "technically valid" and "commercially correct." And it's one of the most expensive invoice errors to find manually — because nobody checks unless something feels off.

In RechnungRadar, contract compliance is a separate validation layer that runs alongside e-invoice checks and buyer policy:

→ **Payment terms mismatch** — contract says Net 30, invoice says Net 14? Flagged with evidence showing both values.

→ **Recurring amount anomaly** — subscription fee jumped 15% without notice? Flagged if deviation exceeds the configurable tolerance.

→ **Validity window check** — contract expired two months ago but invoices keep arriving? Flagged.

→ **One-time fee repetition** — setup fee billed twice on separate invoices? Flagged with references to prior occurrences.

The key design principle: contract terms must be **confirmed by a human** before enforcement. The system can suggest terms from uploaded contract documents, but suggestions never block invoices. Only confirmed terms do.

Industry data suggests that in subscription-heavy portfolios, recurring amount anomalies affect roughly 3–7% of invoices. For Kanzlei offices managing contracts across dozens of mandants, a single caught mismatch can save hours of follow-up.

Full deep dive: https://kaleji.dev/posts/contract-to-invoice-compliance/

#ContractCompliance #EInvoicing #AccountsPayable #InvoiceValidation #Kanzlei #Buchhaltung #PaymentTerms #VendorManagement #FinanceOps #RechnungRadar
