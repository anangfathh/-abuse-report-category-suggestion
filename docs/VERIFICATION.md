# Verification — 15 November 2026

## Status

This report records the initial standalone source verification. The owner subsequently requested Docker hosting at abuse-reporter.qudo.id; see DEPLOYMENT.md for the live deployment checks. No mutation of the existing classifier service or integration with NarasiAhli application/data was performed.

### Production build

`npm run build` succeeds with Next.js 16.4.6, React 19.2.7, Node 24.21.0. Routes: `/` and same-origin BFF `/api/[...path]`.

### Automated acceptance

Full run: **13 tests pass, 0 fail, including browser E2E** (five domain tests, six BFF integration subtests, one browser subtest, and parent integration suite counted by Node test runner). Default `npm test` skips the optional browser subtest unless `RUN_BROWSER_TESTS=1`.

Test service and SQLite are isolated ephemeral fixtures. No fixture decision was submitted to production knowledge. Browser screenshots show fixtures, not real user content.

- State adapter: completed requires valid result/boolean; failed/processing with needs_review=false never become “safe”. Pending uses non-final prediction.
- Strict submission and decision validation, bounds, explicit human choice, rule relationship and duplicates, text/external evidence.
- Login cookie, Origin, CSRF, operator/reviewer/admin permissions, admin user operations, tenant and submission ownership isolation.
- Final violation/nonviolation, exact/similar provenance including null prediction, pending → human → final.
- Idempotency after lost submission response; changed payload returns 409. Server-side submission mapping persists request and service IDs for recovery.
- Human decision once, stale-revision conflict, correction with current top-level revision, chronological events and previous knowledge revocation. No POST knowledge endpoint invented.
- Lost mutation response recovered with GET; no automatic replay. Effective reuse/warnings surfaced.
- 429 Retry-After, 401, 413, 422, 502, 504 and classification_id recovery. Unknown routes/methods blocked.
- Browser: login → direct final → new submission → pending → human choice → final/correction workspace; knowledge page; desktop/mobile rendering, no horizontal mobile overflow, no page errors, no localStorage, no direct browser upstream traffic.
- No actual service keys/password in returned HTML, BFF user/submission/taxonomy responses or default logs in fixture checks.

Screenshots:

- `screenshots/klasifikasi-desktop.png`
- `screenshots/review-desktop.png`
- `screenshots/knowledge-desktop.png`
- `screenshots/klasifikasi-mobile.png`

The host browser lacked a shared audio library; browser test used an extracted temporary `libasound2t64` library via LD_LIBRARY_PATH, without modifying system packages/configuration. This is environment-only, not a runtime application dependency.

### Live service contract smoke

Read-only smoke on existing target with operator-held keys: health, taxonomy, pending review list and knowledge list **HTTP 200**. Snapshot version `x-policy-2026-11-11-v1`, 14 categories/50 rules. Counts are evidence, not hardcoded UI assumptions. Report includes keys/types/counts only; no credentials or real content: `live-contract-smoke.json`.

Empty live review/knowledge lists meant live detail/decision response shape could not be exercised read-only. Source and supplied OpenAPI were used for these responses; fixture acceptance validates those contracts. Live production classification, reviewer decision/correction, revoke/reindex and full target E2E are **not verified**. A separate test tenant and a human reviewer are required before live mutation acceptance. Do not describe fixture E2E as live E2E.

## Explicit delivery limits

- Initial source delivery needed runtime configuration. Subsequent Docker deployment and application accounts are documented separately in DEPLOYMENT.md. No credentials or production keys are included in source.
- Single-instance SQLite pilot, long-request capable hosting required. No horizontal scaling/durable inference transport job implementation.
- User provisioning/role/active state included; SSO, password-reset email, forced first-login password change and automated data retention are not included.
- App ledger retains submission payload for recovery; retention is operator-controlled and documented, not automatic.
- Shared reviewer key is labeled as integration attribution; individual service actor attribution requires provisioning per-reviewer keys.
- Browser screenshots and automated human decisions belong to isolated fixtures only. Production human approval is not automated.

## GitHub delivery

Requested repository: `anangfathh/-abuse-report-category-suggestion`. SSH identity is `anangfathh`. Initial repository metadata check returned `visibility=public`, and push was held because the original request specified private. The owner subsequently explicitly approved public visibility. Publish only source/docs and fixture screenshots; no keys, application database, credentials, or production payloads. No attempt was made to publish to another owner or overwrite NarasiAhli.

### Dependency audit

Initial pins reused local versions; npm audit identified outdated Next.js/Zod and transitive packages. Updated to Next.js 16.4.6 and Zod 4.6.7 before delivery; build, acceptance tests and final audit rerun on the final lockfile.
