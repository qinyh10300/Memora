# Memora deployment and recovery runbook

## Scope

This runbook covers the single-server Docker Compose deployment. PostgreSQL is the source of truth;
its custom-format archive includes users, workspaces, memories, encrypted or protected `BYTEA` assets,
document chunks, citations, Agent execution records, and the Alembic revision.

## Backup

Start the database and create an atomic archive:

```sh
make db
make backup
```

The command writes a mode-`0600` `.dump`, `.dump.sha256`, and `.dump.json` bundle below
`artifacts/backups/`. The archive is listed with `pg_restore` before publication. Defaults retain both
the newest 14 archives and no archive older than 14 days; whichever limit removes an archive first
wins.

Use explicit settings in a scheduler rather than storing them in Git:

```sh
BACKUP_DIR=/srv/memora/backups \
BACKUP_RETENTION_DAYS=30 \
BACKUP_RETENTION_COUNT=30 \
/srv/memora/scripts/db-backup.sh
```

Example daily cron entry:

```cron
17 2 * * * cd /srv/memora && BACKUP_DIR=/srv/memora/backups ./scripts/db-backup.sh >>/var/log/memora-backup.log 2>&1
```

Every bundle is classified as `restricted` and explicitly records that it contains protected user
content. The local archive is intentionally readable only by its owner; it is not an encrypted export
format. Before moving a bundle off-host, run the local policy check:

```sh
make verify-backup-policy BACKUP=/absolute/path/to/memora-YYYYMMDDTHHMMSSZ.dump
```

Off-host storage must satisfy all of these controls:

1. Transfer uses authenticated TLS 1.2+, SSH/SFTP, or a private provider endpoint. Do not send a dump
   through email, chat, an unauthenticated URL, or removable media without device encryption.
2. The destination encrypts every object at rest with a customer-managed KMS key or an equivalent
   envelope-encryption key. The key is stored separately from the backup data and follows a documented
   rotation and recovery policy.
3. Backup writers cannot read or delete existing archives; restore operators use a separate,
   time-limited role. Public access is disabled.
4. Object reads, writes, deletes, policy changes and KMS decrypt operations are retained in an access
   audit log with alerts for unexpected principals.
5. Retention and legal deletion rules apply to the remote copy as well as the local copy.

Record the non-secret key ID and controls in the deployment system, then make offsite readiness an
explicit gate:

```sh
BACKUP_OFFSITE_TRANSPORT_ENCRYPTED=true \
BACKUP_OFFSITE_STORAGE_ENCRYPTED=true \
BACKUP_OFFSITE_ACCESS_AUDIT_ENABLED=true \
BACKUP_OFFSITE_KEY_REFERENCE='kms://backup-key-id' \
make verify-backup-policy \
  BACKUP=/absolute/path/to/memora-YYYYMMDDTHHMMSSZ.dump \
  OFFSITE=1
```

Only after this gate passes should the completed three-file bundle be copied outside the application
host. A local volume alone does not protect against disk or host loss.

## Restore verification

Never test a backup by replacing the active database. Restore into a temporary, unpublished pgvector
container:

```sh
make verify-backup BACKUP=/absolute/path/to/memora-YYYYMMDDTHHMMSSZ.dump
```

The verifier checks the SHA-256 sidecar and archive structure before restore, then checks the current
Alembic head, core row counts, stored asset bytes, and citation referential integrity. It writes a JSON
report under `artifacts/` and removes the isolated database and volume even after failure.

For a release drill that must prove all fact types exist, set minimums:

```sh
VERIFY_MIN_USERS=1 \
VERIFY_MIN_WORKSPACES=1 \
VERIFY_MIN_MEMORIES=1 \
VERIFY_MIN_ASSETS=1 \
VERIFY_MIN_CITATIONS=1 \
make recovery-drill
```

## Application rollback

Database migrations are forward-compatible for the supported release window. If a release fails:

1. Stop writes or place the proxy in maintenance mode.
2. Record the failing image digests, request IDs, metrics, and current Alembic revision.
3. Repoint `api`, `worker`, and `web` to the last known-good immutable image digests.
4. Do not run `alembic downgrade` against the active database. Keep new tables and nullable columns.
5. Start the old application, then verify `/health`, `/ready`, login, workspace isolation, and a read-only
   memory request before reopening writes.
6. Fix schema or data with a new forward migration. Use destructive database restore only for declared
   disaster recovery, not routine release rollback.

The normal Compose file supports immutable image overrides without editing YAML. Switch only the
traffic-serving application processes; this command does not run `migrate` or `seed`:

```sh
make switch-images \
  API_IMAGE=registry.example/memora-api@sha256:... \
  WORKER_IMAGE=registry.example/memora-worker@sha256:... \
  WEB_IMAGE=registry.example/memora-web@sha256:...
```

The switch resolves and records the actual image IDs, recreates `api`, `worker` and `web` with
`--no-build --no-deps`, verifies process health, and fails if the Alembic revision changes. Reopen
writes only after the read-only login and memory smoke succeeds. Roll forward by running the same
command with the last verified current image references.

If the old application cannot tolerate the new schema, keep traffic closed and roll forward to a fixed
application image. Never delete newly written facts to make an old binary start.

Exercise the rollback path before a release with immutable prior images and a verified backup:

```sh
ROLLBACK_API_IMAGE=registry.example/memora-api@sha256:... \
ROLLBACK_WORKER_IMAGE=registry.example/memora-worker@sha256:... \
ROLLBACK_WEB_IMAGE=registry.example/memora-web@sha256:... \
ROLLBACK_SMOKE_EMAIL=rollback-check@example.com \
ROLLBACK_SMOKE_PASSWORD='from-the-secret-store' \
make rollback-drill BACKUP=/absolute/path/to/memora-YYYYMMDDTHHMMSSZ.dump
```

The drill restores the backup into an isolated database, starts the old API, worker, web, and proxy,
logs in through the proxy, reads the account's personal workspace and a memory, and confirms that the
Alembic revision is unchanged. It records resolved image digests in `artifacts/application-rollback-drill.json`
and removes all temporary containers, network, and volume.

## Production-safe defaults

- Keep the real `.env` at mode `0600`. `make setup` creates or repairs that mode, and `make check`
  rejects a group- or world-readable file. Store production secrets in the deployment secret store.
- Development seed data is disabled by default and is rejected entirely when `APP_ENV=production`.
- Prometheus metrics are disabled by default. Enabling them requires a dedicated 32+ character
  `METRICS_TOKEN`; scrapers must send `Authorization: Bearer <token>`. Do not reuse a session or AI key.
- Database exceptions hide bound parameters and discard PostgreSQL server `DETAIL`, statement and
  parameter payloads before traceback formatting while retaining the exception class and SQLSTATE.
- Keep the proxy, database and metrics token on a private network; expose only the required public
  application ports.

## Disaster recovery

On a replacement host, verify the selected bundle first, create an empty PostgreSQL database using the
same pgvector major version, restore with `pg_restore --exit-on-error --no-owner --no-privileges`, and
start the matching application images. Validate the revision and counts again before changing DNS or
the public proxy.
