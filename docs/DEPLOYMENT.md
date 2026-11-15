# Docker deployment — abuse-reporter.qudo.id

Deployment on 15 November 2026, requested by repository owner. Public app origin: **https://abuse-reporter.qudo.id**. Source image `abuse-reporter:9dd47a6` (Next.js 16.4.6). The classifier/review/knowledge service remains independent and is consumed over configured HTTP API.

## Runtime layout

- Docker Compose project/container `abuse-reporter`; non-root Node user.
- Persistent Docker volume `abuse-reporter-data` stores **application** SQLite user/session/audit/submission ledger. No moderation service PVC/database access.
- App port 3040 binds only to the server-private interface for ingress access, not to every interface. Compose defaults loopback for other installations; explicitly configure BIND_ADDRESS for an existing ingress deployment.
- Existing Kubernetes nginx ingress routes this domain to the Docker origin through a selectorless Service/EndpointSlice in new namespace `abuse-reporter`. No NarasiAhli ingress/config was replaced.
- Dedicated cert-manager certificate `abuse-reporter-tls` with Let's Encrypt issuer and automatic renewal. HTTPS redirect enabled by ingress TLS; read/send proxy timeout 300 seconds, body limit 128 KiB (BFF limit 96 KiB).
- Docker restart policy `unless-stopped`; health check every 30 seconds. JSON log rotation 10 MiB × 3.

## Server-only configuration

Deployment environment is stored **outside** this repository under `/root/.config/abuse-reporter/`, directory mode 0700 and credential files mode 0600:

- `production.env`: origin, secure cookies, application DB path and tenant API key mapping.
- `compose.env`: image, private bind address and environment file path.
- `admin-login.json`: generated initial application admin login, delivered privately to owner. Not committed, not part of image/browser.

Existing service keys were used server-side for the configured tenant. Initial admin provisioned into application SQLite, not into the moderation service. Do not copy deployment credential files into the repository or container build context.

## Operator commands

Run from repository root; deploy credentials/compose configuration first.

```sh
docker build -t abuse-reporter:9dd47a6 .
docker compose --project-name abuse-reporter \
  --env-file /root/.config/abuse-reporter/compose.env \
  -f deploy/compose.yaml up -d
docker ps --filter name=abuse-reporter
docker logs --tail=50 abuse-reporter
curl -f https://abuse-reporter.qudo.id/api/health
```

Render `deploy/ingress.template.yaml` with the private origin IP replacing `__ORIGIN_IP__`, inspect the rendered file, then `kubectl apply -f` that file. The existing cluster must already have nginx ingress and ClusterIssuer `letsencrypt-prod`. Do not apply placeholder IP directly. DNS must point to the ingress's public address; on this server the domain already resolved correctly, so no DNS record change was needed.

On updates build a new immutable image tag and change APP_IMAGE in server-only compose.env. Preserve the named volume. For rollback restore prior APP_IMAGE and run compose up again. Do not run `down -v` unless application data removal is explicitly intended. Back up SQLite consistently as described in README; do not expose DB backups via web/static paths.

## Deployment verification

- Container starts and reports healthy.
- Public HTTPS certificate validates and hostname matches; HTTP redirects to HTTPS.
- Public login returns 200, session cookie Secure + HttpOnly, `/api/me` returns configured admin role.
- Authenticated BFF taxonomy, pending review list, knowledge list, submission list and logout return 200.
- Docker origin can reach taxonomy/review/knowledge API with server-only credential mapping.
- Actual HTTPS browser login, taxonomy and navigation/mobile checks performed separately from earlier fixture acceptance.
- Existing NarasiAhli health and bridge iptables setting checked after Docker startup; unchanged/healthy.

No production classification, reviewer decision/correction, revoke or reindex was performed as deployment smoke. Full live inference/human-review mutation acceptance still needs dedicated test content/tenant and a human reviewer; earlier 13-test E2E suite uses isolated fixtures.
