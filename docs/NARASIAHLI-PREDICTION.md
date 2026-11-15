# NarasiAhli prediction integration

The owner clarified that **new model predictions must consume the original NarasiAhli API**, not the standalone classifier's direct model transport. This clarification supersedes the original handoff's requirement not to call the NarasiAhli API. Existing HITL behavior is retained.

## Actual call chain

```text
Browser → Next.js BFF → existing review workflow
                            ├─ approved human knowledge reuse, when eligible
                            └─ new prediction → NarasiAhli
                               POST /api/v1/external/moderation/classify
```

The original classify endpoint does not expose review queues, knowledge, classification polling/history or revisioned human decisions. For that reason the existing service still supplies these workflow endpoints. It is **not a second classifier** for the application's opted-in tenant: the adapter calls the original NarasiAhli classify API and never silently falls back to the service's local LLM classifier.

Review SQLite/PVC and app SQLite/volume are preserved. No app content is moved into the NarasiAhli knowledge/HITL database. The adapter sends only the legacy request fields `platform`, `content`, `context`; workflow metadata stays in the review workflow.

## Key placement

- Browser → BFF uses human session + CSRF, no API keys.
- BFF → review workflow keeps the existing server-side tenant `clientKey` / `reviewerKey` mapping.
- Review workflow → NarasiAhli uses a **dedicated NarasiAhli integration key**, permissions only `moderation:read` and `moderation:classify`.
- That key is stored in Kubernetes Secret `moderation-lab/abuse-reporter-narasiahli`, key `api-key`, referenced by environment `MODERATION_NARASIAHLI_API_KEY`. It is not the older `mod_live_` workflow key and is never committed or sent to the browser.

The internal API base is configurable in `MODERATION_NARASIAHLI_API_BASE_URL`; it points to the existing backend service, path `/api/v1/external/moderation`. Public equivalent: `https://narasiahli.qudo.id/api/v1/external/moderation`.

## Opt-in, validation and provenance

`MODERATION_NARASIAHLI_TENANTS` lists only opted-in tenants. Others retain their pre-existing prediction transport. Human exact/similar reuse behavior remains service-controlled; a reused decision does not pretend it made a fresh prediction request.

The adapter:

1. GETs the legacy `/taxonomy`, checks version/categories against the workflow policy, and fails closed on mismatch.
2. POSTs to legacy `/classify`, with a 120-second timeout and no implicit retry/redirect.
3. Validates rule IDs, exact evidence quotes, consistency, final booleans and required legacy request ID using existing policy validation. No new model call is used to validate an API result.
4. Attaches `prediction_provider=narasiahli`, `prediction_endpoint`, and `prediction_request_id`. The UI displays provider and request ID for predictions.

Authorization/rate/validation errors and Retry-After propagate. Timeout or unavailable API does not become a safe result, does not auto-approve human review, and does not switch classifier behind the user's back.

Similarity knowledge equivalence remains part of the existing human-knowledge reuse guard, not a replacement source of base classification. Human decisions still require actual reviewers.

## Operations and rollback

Legacy API was discovered disabled (`MODERATION_ENABLED=false`) during verification. The operator inspected/backed up the backend deployment and enabled that existing feature flag. No NarasiAhli application source was changed. `deploy/narasiahli-enable-predict.patch.yaml` records the scoped strategic patch.

`review-service/` contains the existing moderation review workflow source copied from the earlier project, plus the optional adapter/configuration. The original source project was not overwritten. Review image `abuse-reporter-review:narasi-v1` is applied to existing `moderation-lab/moderation-service`; its existing deployment env, keys, and persistent data remain intact. A consistent SQLite backup was created before switching the image. Do not apply the provided template as a full replacement deployment; use a strategic merge patch after rendering the tenant IDs and provisioning the Secret.

Frontend Docker image after provider labeling: `abuse-reporter:narasi-v1`, same app persistent volume and secure environment. Rollback can restore prior review image/env from the server-only deployment backup and prior frontend APP_IMAGE. Do not delete PVCs/volumes to roll back a provider change. The legacy enable flag should not be disabled if other authorized consumers now depend on it.

## Verification

- Review workflow/adapter suite: **95 passed**, including legacy HTTP transport, strict payload, provenance, error/timeout/no-fallback checks, opted-in tenant selection, and preserving pending/final workflow semantics.
- Frontend/BFF/browser suite: **13 passed**, including rendering NarasiAhli provider/request ID.
- Live legacy taxonomy: HTTP 200, policy version/categories match existing workflow.
- Live inference proof uses a **separate smoke tenant**, not the user's production submission ledger, and does not submit a reviewer decision or create human knowledge. Sanitized result/provenance: `narasiahli-prediction-smoke.json`.
- Existing tenant data retained; other tenants keep their previous transport.

To run review tests in an isolated container, install pytest in that ephemeral test environment and mount `review-service/` as the test workspace. Do not point fixture tests at production SQLite or keys.
