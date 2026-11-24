# Docker deployment — abuse-reporter.qudo.id

Deployment on 15 November 2026, requested by repository owner. Public app origin: **https://abuse-reporter.qudo.id**. Source image `abuse-reporter:9dd47a6` (Next.js 16.4.6). The classifier/review/knowledge service remains independent and is consumed over configured HTTP API.

Subsequent owner correction: new base predictions must use the original NarasiAhli classify API. Current frontend image is `abuse-reporter:narasi-v1`; an optional per-tenant adapter is deployed in the existing review workflow. See [NARASIAHLI-PREDICTION.md](NARASIAHLI-PREDICTION.md) for actual call chain, key placement, state preservation and live proof. The earlier statement about a fully independent classifier no longer describes the selected prediction provider for this app.

## Runtime layout

- Docker Compose project/container `abuse-reporter`; non-root Node user.
- Users, sessions, audit and submissions are stored in application PostgreSQL (`APP_DATABASE_URL`, schema `abuse_reporter`). The named volume is retained for existing files; it is not the current database source of truth.
- App port 3040 binds only to the server-private interface for ingress access, not to every interface. Compose defaults loopback for other installations; explicitly configure BIND_ADDRESS for an existing ingress deployment.
- Existing Kubernetes nginx ingress routes this domain to the Docker origin through a selectorless Service/EndpointSlice in new namespace `abuse-reporter`. No NarasiAhli ingress/config was replaced.
- Dedicated cert-manager certificate `abuse-reporter-tls` with Let's Encrypt issuer and automatic renewal. HTTPS redirect enabled by ingress TLS; read/send proxy timeout 300 seconds, body limit 128 KiB (BFF limit 96 KiB).
- Docker restart policy `unless-stopped`; health check every 30 seconds. JSON log rotation 10 MiB × 3.

## Server-only configuration

Deployment environment is stored **outside** this repository under `/root/.config/abuse-reporter/`, directory mode 0700 and credential files mode 0600:

- `production.env`: origin, secure cookies, application PostgreSQL URL and server-side moderation API key.
- `compose.env`: image, private bind address and environment file path.
- `admin-login.json`: generated initial application admin login, delivered privately to owner. Not committed, not part of image/browser.

Existing service keys were used server-side for the configured tenant. Initial admin is an application account, not a moderation-service credential. Do not copy deployment credential files into the repository or container build context.

## Operator commands

Run from repository root; deploy credentials/compose configuration first.

```sh
docker build -t abuse-reporter:x-submenu-20261124 .
docker compose --project-name abuse-reporter \
  --env-file /root/.config/abuse-reporter/compose.env \
  -f deploy/compose.yaml up -d
docker ps --filter name=abuse-reporter
docker logs --tail=50 abuse-reporter
curl -f https://abuse-reporter.qudo.id/api/health
```

Render `deploy/ingress.template.yaml` with the private origin IP replacing `__ORIGIN_IP__`, inspect the rendered file, then `kubectl apply -f` that file. The existing cluster must already have nginx ingress and ClusterIssuer `letsencrypt-prod`. Do not apply placeholder IP directly. DNS must point to the ingress's public address; on this server the domain already resolved correctly, so no DNS record change was needed.

On updates build a new immutable image tag and change APP_IMAGE in server-only compose.env. Preserve the named volume. For rollback restore prior APP_IMAGE and run compose up again. Do not run `down -v` unless application data removal is explicitly intended. Back up PostgreSQL before data changes; do not expose DB backups via web/static paths.

## Deployment verification

- Container starts and reports healthy.
- Public HTTPS certificate validates and hostname matches; HTTP redirects to HTTPS.
- Public login returns 200, session cookie Secure + HttpOnly, `/api/me` returns configured admin role.
- Authenticated BFF taxonomy, pending review list, knowledge list, submission list and logout return 200.
- Docker origin can reach taxonomy/review/knowledge API with server-only credential mapping.
- Actual HTTPS browser login, taxonomy and navigation/mobile checks performed separately from earlier fixture acceptance.
- Existing NarasiAhli health and bridge iptables setting checked after Docker startup; unchanged/healthy.

No production classification, reviewer decision/correction, revoke or reindex was performed as deployment smoke. Full live inference/human-review mutation acceptance still needs dedicated test content/tenant and a human reviewer; earlier 13-test E2E suite uses isolated fixtures.

## Report-menu label correction (24 November 2026)

The taxonomy view now separates nine screenshot-verified English Report names
from two independently documented but not live-verified labels, and from internal
policy checks without a verified menu counterpart. Policy details are not
advertised as verbatim X submenu names. Labels stay English when policy-detail
language changes. The source catalogue is versioned JSON served by NarasiAhli;
PostgreSQL stores the classification/review result snapshots.

The backend/review label migration updated presentation metadata only. Source
rule IDs, evidence, assessments and human decisions remain unchanged. Full and
row-level private backups were made before updating stored snapshots.

The VM's DHCP interface changed from its old private address after reboot. This
deployment now publishes the Docker origin on the private Docker bridge
`172.17.0.1:3040`; the ingress EndpointSlice uses that same bridge address.
`NARASIAHLI_IP=host-gateway` keeps the internal HTTPS hostname mapping independent
of the VM's DHCP address. Neither port 3040 nor service credentials are published
on all host interfaces. Preserve these values in server-only `compose.env`.

### Officially documented submenu references

The private/non-consensual branch includes two verbatim labels sourced from X's
official intimate-media and US Take It Down Act instructions. They are marked
`official_help_documented`, not live-UI verified. The US route is reference-only
and never inferred from a classifier result. Other branches explicitly remain
unverified; the full authenticated tree needs additional screenshots. Original
policy detail names remain available separately, including on stored results.
