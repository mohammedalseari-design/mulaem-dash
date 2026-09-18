# Task: phase 0 — keep the project alive and backed up

Small, self-contained round. See `docs/ROADMAP.md` phase 0. No UI changes.

## 1. Commit the untracked docs (commit: "docs: roadmap and task files")

`docs/ROADMAP.md`, `docs/TASK_HARDENING.md`, `docs/TASK_PHASE0.md` and `docs/DOMAIN.md` are on disk but untracked;
the other `docs/TASK_*.md` files are tracked. Add all of them. Also commit the pre-existing whitespace/BOM change in
`scripts/migrate-images.ps1` as part of this commit, with a one-line note in the body saying it is an editor artefact
and the script's behaviour is unchanged — verify that is true before saying it.

## 2. Keepalive (commit: "ops: daily keepalive so the free project does not pause")

Supabase pauses a free project after 7 days without activity. It already happened once on another project of the
owner's, and a paused project means the dashboard and the CRM both go dark until someone restores it by hand.

- Migration `supabase/migrations/010_keepalive.sql`, applied with the Supabase MCP under the name `keepalive`:

  ```sql
  create or replace function public.keepalive() returns timestamptz
  language sql stable security invoker set search_path = public as $$ select now() $$;
  revoke all on function public.keepalive() from public;
  grant execute on function public.keepalive() to anon, authenticated;
  ```

  It returns the server time and reads no table, so granting it to `anon` exposes nothing. Do not grant anything
  else to `anon` — the rest of the schema stays closed.

- `.github/workflows/keepalive.yml`: `schedule: cron '17 4 * * *'` plus `workflow_dispatch`, one step that POSTs to
  `https://niykzsspdehexphewlxa.supabase.co/rest/v1/rpc/keepalive` with the **publishable** key
  (`sb_publishable_GUx3i6pNJE56TidkxaItMg_0zwRSaVi`, already public in `js/config.js` — no secret needed) and fails
  the job on a non-2xx response with `curl --fail`. Add `permissions: contents: read`.
- In the workflow file, add a comment noting that GitHub disables scheduled workflows in a repository with no
  activity for 60 days, so the schedule needs a manual re-enable if the repo goes quiet that long.
- Run it once with `workflow_dispatch` (or `gh workflow run`) and report the run's conclusion.

## 3. Nightly backup (commit: "ops: nightly database backup")

The free plan has no backups, and commissions are financial records.

- `.github/workflows/backup.yml`: daily cron, `workflow_dispatch`, `permissions: contents: read`.
- Steps: install the Postgres client matching the server major version, run
  `pg_dump "$SUPABASE_DB_URL" --no-owner --no-privileges --clean --if-exists -f "mulaem-$(date -u +%F).sql"`,
  gzip it, then `actions/upload-artifact` with `retention-days: 90`.
- `SUPABASE_DB_URL` comes from `secrets.SUPABASE_DB_URL`. If the secret is missing the job must exit with a clear
  message ("add the SUPABASE_DB_URL secret — see docs/BACKUP.md") rather than failing obscurely or, worse, uploading
  an empty file.
- Write `docs/BACKUP.md` in Arabic: where the owner finds the connection string in the Supabase dashboard
  (Project Settings → Database → Connection string → URI, session pooler), how to add it as a repository secret
  (Settings → Secrets and variables → Actions → New repository secret, name `SUPABASE_DB_URL`), how to download a
  backup artifact, and the one command that restores it into a fresh project. State plainly that the artifact
  expires after 90 days and that this is a stopgap for the free plan, not a substitute for Supabase Pro's
  point-in-time recovery once there is real money in the system.
- **Do not put the connection string, the database password, or any secret in the repository or in a commit.** The
  owner adds the secret himself; the workflow must be committed and working before he does, and must fail cleanly
  until then.

## Finish

Push and report the commit hashes, the keepalive run result, and the backup job's behaviour with the secret absent.
