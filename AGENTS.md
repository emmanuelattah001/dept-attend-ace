# Architecture rules

- Introduce the institution hierarchy additively, preserving legacy department IDs and attendance relationships; this prevents disruption of existing scans and records.
- Store hierarchy administrator scopes in a protected membership table, never profile metadata; authorization must be enforced by database policies.
- Keep hierarchy management separate from attendance administration until every attendance and archive service supports institution isolation; new hierarchy roles must not inherit the department-admin page.