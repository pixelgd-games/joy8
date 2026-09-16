# Looty Analytics and Monitoring

Status: planned; not implemented.

This document owns operational analytics, KPI definitions, dashboards, request telemetry, health checks, alerts, and the initial reliability rollout. It does not own member authentication or the game runtime contract.

Current repository behavior is defined in `../../README.md`.

Last reviewed: 2026-09-15.

## Goals

Build an analytics and monitoring system that one person can operate during public validation and early commercial validation.

Principles:

- Show a metric only when its source is reliable.
- Display `unavailable` instead of a false zero.
- Reuse dashboard templates and variables across games.
- Give reporting tools read-only access to purpose-built views.
- Do not modify a game repository merely to satisfy the first monitoring phase.
- Keep test POINT, operational POINT activity, and actual payment receipts separate.
  A POINT fee or AI funding entry is not cash revenue. The product and integration
  documents own the corresponding wallet and transaction-source definitions.
- Add game instrumentation only through the Looty integration contract.
- Never record credentials, launch codes, Gateway tokens, or complete request bodies.

## Proposed Initial Stack

The current low-operations proposal is:

| Tool | Proposed use |
| --- | --- |
| Grafana Cloud | Dashboards, synthetic monitoring, and email alerts |
| Supabase Postgres | Reporting source, aggregate views, and Gateway request events |
| Supabase Reports | Database capacity and performance inspection |
| Cloudflare Web Analytics | Lobby traffic and front-end web signals |
| Windows scheduled task plus private encrypted storage | Logical database backup and retention |

This is a plan, not an installed dependency. Recheck current pricing, quotas, retention, and connector support before implementation. Do not add Metabase, Prometheus, Sentry, PagerDuty, or self-hosted Grafana in the first phase unless a measured requirement appears.

## Data Availability

### Reliable From Current Data

- Successfully created launch sessions.
- Sessions grouped by game and `games.type`.
- Guest, wallet, transaction, and round record counts.
- Demo `POINT` bet, payout, and refund totals where games use the Gateway.
- Open or expired sessions and rounds.
- Database size and growth, when reported from the database service.
- Static Lobby availability through an external synthetic check.

### Not Yet Reliable

- DAU, WAU, and MAU.
- Concurrent users.
- Average play time.
- Game-load success rate.
- Complete Gateway error rate.
- Gateway p50 and p95 latency.
- Production round volume or RTP.

These remain unavailable until the required identity or event source exists.

## Dashboard Model

### Platform Overview

Initial panels:

- Launch sessions for today, 7 days, and 30 days.
- Session trend and ranking by game.
- Session distribution by game type.
- Counts of platform players, wallets, transactions, and rounds.
- Demo `POINT` bet, payout, and refund totals.
- Open and overdue sessions or rounds.
- Database size and growth.
- Lobby and Gateway health after non-mutating health checks exist.
- Recent Critical and Warning alerts.

Later panels:

- DAU, WAU, and MAU.
- Concurrent users.
- Average play time.
- Trusted round metrics.
- RTP.
- Gateway error rate and p95 duration.

### System Health

- Lobby availability and response time.
- Gateway health and response time.
- Gateway 4xx, 5xx, and 429 counts after request telemetry exists.
- Gateway p50 and p95 duration.
- Database capacity.
- Long-running open sessions and rounds.
- Negative balances or wallet-to-transaction inconsistencies.
- Recent operational alerts.

### Game Type Overview

Create this only after there are enough games and reliable activity:

- Active accounts, sessions, and trusted rounds by `games.type`.
- Game ranking within each type.
- Average play time when heartbeat exists.
- Demo bet, payout, refund, and RTP where valid.
- Error and latency breakdown.

Do not create a second analytics classification beside `games.type`.

### Game Detail

Use one dashboard template with a game variable:

- Game name, type, and published status.
- Launch sessions and trend.
- Existing Gateway rounds and Demo wallet transactions.
- Open sessions and rounds.
- Gateway errors when request telemetry exists.
- Later: active accounts, concurrent users, play time, game-load success, trusted rounds, RTP, and latency.

Do not build a separate custom dashboard for every game.

## KPI Definitions

### Launch Session

Count successfully created `game_sessions`.

This proves that Looty issued launch authorization. It does not prove that the iframe loaded, the game became ready, or the player completed a round.

### Active Accounts

Count distinct `player_account_id` values with trusted activity during the period.

Until guest reuse or stable anonymous identity is implemented, label this metric `Active Accounts`, not DAU, WAU, or MAU. One person may currently create several guest accounts.

Member and persistent guest design is owned by `../platform/MEMBER_AUTH_PLAN.md`.

### DAU, WAU, and MAU

After stable identity exists:

- DAU: distinct active platform players per calendar day.
- WAU: distinct active platform players in the trailing 7 days.
- MAU: distinct active platform players in the trailing 30 days.

Define the reporting timezone explicitly before publishing these metrics.

### Concurrent Users

Count distinct non-expired sessions with a heartbeat in the most recent five minutes.

Do not use `game_sessions.status = active` alone; it overstates concurrency when a player closes the page without a session-close event.

### Round

A round is uniquely identified by `game_session_id + round_id`.

Only include a round after the game reports it through the authorized platform contract. For a game that does not use Gateway rounds, show `unavailable`, not zero.

### Average Play Time

Measure from a trusted session-start event to the last heartbeat or explicit close event.

The iframe `load` event is insufficient. Do not publish average play time until heartbeat or a reliable close signal exists.

### Gateway Error Rate

```text
failed requests / all requests
```

Break it down by route, game, and status code. Successful database transactions alone cannot produce an error rate.

### Gateway Duration

Record `duration_ms` for each Gateway request and report p50 and p95. An average alone can hide slow-tail failures.

### RTP

For settled, non-refunded, trusted rounds:

```text
RTP = total payout / total bet x 100%
```

Rules:

- Do not display RTP when valid bet total is zero.
- Exclude refunded rounds according to an explicitly reviewed calculation.
- Current data can produce only Demo RTP.
- A browser-generated result is not valid production or redeemable-value RTP.
- Production RTP requires an authoritative game server or adjudication source.
- Apply this metric only to games whose approved model defines comparable bet
  and payout totals. Multiplayer transfers such as Mahjong settlement must not
  automatically be presented as house-banked RTP; its fees and AI-versus-human
  reports follow the product's accounting definitions.

## Gateway Request Event

The current Gateway emits JSON console logs containing event name, request ID, route, method, status, duration, and Origin. Those runtime logs are not a retained reporting table and are not yet connected to dashboards or alerts.

The first retained request-event record should contain only:

- `request_id`
- `route`
- `game_id`, when known
- `game_session_id`, when known
- `status_code`
- `error_code`
- `duration_ms`
- `created_at`

It must not contain:

- Email, phone number, or provider profile.
- Launch code.
- Gateway token.
- Supabase access token.
- Service-role key.
- Authorization headers.
- Full URL query strings containing launch values.
- Complete request or response bodies.

Initial request-event retention target: 30 days. Re-evaluate it against actual volume, incident needs, privacy obligations, and the current database plan before implementation.

## Game Activity Events

Heartbeat, game-ready, play-time, and game error events belong to a future version of `../platform/GAME_PLATFORM_INTEGRATION.md`.

Rules:

- Games report through the Gateway or another explicitly reviewed Looty endpoint.
- Games never write an analytics table directly.
- No game repository is changed until the user names the game and puts that repository in scope.
- A game without these events remains playable and shows unavailable metrics.
- One selected game should validate the contract before wider rollout.

## Reporting Views and Permissions

Create reporting objects through small user-reviewed migrations:

- Platform daily aggregate.
- Game daily aggregate.
- Game-type daily aggregate.
- Wallet and round aggregate.
- System anomaly view.
- Gateway request-event table and required indexes.
- A dedicated read-only reporting role or database user.

Security requirements:

- Reporting access is limited to named views.
- No raw player identity, credential, token, or complete request body is exposed.
- No insert, update, delete, function-execution, or protected-table access is granted.
- Do not use the Supabase anonymous key or service-role key as a Grafana credential.
- Store the reporting password only in the monitoring service's protected configuration.
- Every dashboard query uses a bounded time range.
- Review query plans before enabling frequent refresh.

Follow the migration confirmation rules in `../../AGENTS.md`.

## Health Checks

### Lobby

An external synthetic check should verify:

- HTTPS response success.
- Expected page marker.
- Response duration.

It must not depend on a specific game remaining published.

### Gateway

Add a lightweight, non-mutating health endpoint before monitoring the Gateway.

It should distinguish:

- Edge Function reachable.
- Critical Looty database dependency reachable.

It must not:

- Create a guest, player, wallet, session, round, or transaction.
- Return credentials or internal database details.
- Bypass rate limiting.
- Become a high-cost database query.

Do not monitor health by repeatedly calling `create-session`.

## Alert Levels

Thresholds are initial proposals and must be tuned from real traffic.

### Critical

- Lobby fails two consecutive synthetic checks.
- Gateway health fails two consecutive checks.
- A negative wallet balance is detected.
- Wallet state and transaction history fail a reviewed consistency rule.

### Warning

- Three or more Gateway 5xx responses occur within ten minutes.
- 429 responses increase sharply above the recent baseline.
- Database capacity crosses an internal early-warning threshold.
- A session or round remains open beyond its reviewed maximum age.
- Request latency exceeds the reviewed p95 threshold.

### Info

- A newly published game receives its first session.
- Data volume crosses an observation threshold.
- A deployment or monitoring configuration change completes.

Alerts must link to a short runbook or identify the likely owner: Lobby, Gateway, Supabase, monitoring, or external game.

## Backup and Recovery

Monitoring is not a backup.

The initial proposed process:

- Run a daily logical database dump from a Windows scheduled task.
- Encrypt the dump before synchronization to private cloud storage.
- Retain seven daily copies and four weekly copies.
- Perform a local restore test monthly.
- Use the local `.env.supabase.local` route without copying credentials into scripts, documentation, or chat.

Before implementation, verify that the selected Supabase plan, database connection method, storage provider, encryption, and retention meet current needs. Disaster recovery remains an active limitation in `KNOWN_ISSUES.md`.

## Operating Rhythm

- Daily: review Platform Overview and unresolved alerts.
- On alert: classify the problem as Lobby, Gateway, Supabase, monitoring, or external game.
- Weekly: review game trends, errors, database growth, and overdue rounds.
- Monthly: verify a backup can be restored and review alert thresholds.
- After a production deployment: verify the deployed site, Gateway when changed, and one Loader path.

## Delivery Phases

These are observability increments within the platform -> product -> integration
order in [PRODUCT_SCOPE.md](../product/PRODUCT_SCOPE.md#delivery-order), not a
replacement project roadmap. Minimum health and recovery checks precede operation;
full activity dashboards can follow when their trusted data exists.

### Phase 0: Availability

1. Add a non-mutating Gateway health endpoint.
2. Confirm the current monitoring vendor, limits, and cost.
3. Add Lobby and Gateway synthetic checks.
4. Create the minimal System Health dashboard.
5. Configure Critical availability alerts.

Complete when outages are reported without creating platform business data.

### Phase 1: Current-Data Reporting

1. Confirm whether Cloudflare Web Analytics is enabled and appropriate.
2. Prepare reviewed migrations for request events, reporting views, indexes, and read-only access.
3. Add minimal Gateway request telemetry.
4. Build Platform Overview, System Health, and the shared Game Detail template.
5. Add Warning alerts.
6. Implement and restore-test the backup process.

Only metrics supported by reliable data are shown.

### Phase 2: Player and Game Activity

1. Define the shared game-ready, heartbeat, close, and error event contract.
2. Select one game repository for validation.
3. Implement stable guest or member identity before publishing DAU, WAU, and MAU.
4. Enable concurrency and play time after heartbeat is reliable.
5. Enable RTP only for trusted rounds and wallet data.
6. Add Game Type Overview when the sample size is useful.

## Reassessment Triggers

Reassess the low-cost stack when any of these becomes true:

- Looty accepts real payments.
- A separately approved product decision changes the current prohibition on
  redemption, withdrawal, or prizes of monetary value.
- A formal uptime SLA is required.
- Longer log retention is required.
- Database capacity or query load approaches the current plan's limit.
- Managed backup or point-in-time recovery is required.
- A partner, audit, privacy, security, or regulatory requirement appears.

## Official References

- [Grafana Cloud pricing](https://grafana.com/pricing/)
- [Grafana PostgreSQL data source](https://grafana.com/docs/grafana/latest/datasources/postgres/)
- [Grafana PostgreSQL configuration](https://grafana.com/docs/grafana/latest/datasources/postgres/configure/)
- [Supabase pricing](https://supabase.com/pricing)
- [Supabase Reports](https://supabase.com/docs/guides/telemetry/reports)
- [Cloudflare Web Analytics](https://developers.cloudflare.com/web-analytics/about/)
