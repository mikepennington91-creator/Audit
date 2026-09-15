# Multiple corrective actions on audit non-conformances

A failed audit question retains its existing required corrective action and now offers **Add Corrective Action** for any further actions needed against the same non-conformance.

Each additional action has its own action required, registered owner and due date. Draft additional actions are stored against the open audit run and question. On audit completion the backend validates every additional action and creates a separate corrective-action record with its own company action reference (A-number), while retaining the common audit run, question and non-conformance links.

Existing audits and the existing single-action workflow remain compatible. The enhanced audit-run route is registered before the standard action route so no change to the legacy `server.py` model is required.
