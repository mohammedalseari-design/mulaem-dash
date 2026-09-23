# Mulaem — Technical Audit and CRM Implementation Plan

Audit date 2026-09-18. Read-only inspection of the repo and the live Supabase project
`niykzsspdehexphewlxa` ("ملائم", eu-central-1, Postgres 17.6). Nothing was changed; all DDL below
is a sketch, not applied.

## A. Current architecture map

**Frontend** — static SPA, no build step, GitHub Pages from `main`
(`github.com/mohammedalseari-design/mulaem-dash`, single commit `6c96fa1`).

| File | Lines | Role |
|---|---|---|
| `index.html` | 495 | Whole UI: login, admin dashboard (overview/users/approvals/activity), property form, map, grid + kanban, modal |
| `js/script.js` | 2729 | Legacy logic, untouched, still calls `api/*.php`. All state in globals (`currentUser`, `projects`) |
| `js/supabase-shim.js` | 253 | Monkey-patches `window.fetch`; intercepts `/api/*.php` only; routes `login`, `setup_check`, `projects`, `upload`, `users`, `activities` |
| `js/config.js` | 8 | Project URL + publishable key + `AUTH_EMAIL_DOMAIN` |
| `css/style.css` | 2717 | RTL Arabic design system |
| `tests/shim.test.js` | 104 | 31 assertions on legacy response shapes |

CDN deps: Leaflet 1.9.4 + markercluster, SweetAlert2 v11, supabase-js v2, Google Fonts, OSM tiles.

**Data flow** — `script.js` → `fetch('api/x.php')` → shim → supabase-js → PostgREST → RLS. The shim
re-shapes rows into the old PHP contract (numbers as strings, booleans as `'1'`/`'0'`, money to two
decimals). `projects` GET loads **all** rows unpaginated into a global array; search, filters, stats,
kanban and export are client-side.

**Database** — 3 migrations applied, only the first in the repo: `20260918013445 init_mulaem_schema`
(= `001_init.sql`), `20260918013703 harden_function_privileges` (**not in repo**),
`20260918013807 tune_rls_policies` (**not in repo**). Live rows: `projects` 110, `activities` 50,
`legacy_users` 9, `profiles` **1**, `site_projects` 1, `site_settings` 0.

**Auth, roles, RLS** — Supabase password login; username `ali` maps to `ali@users.mulaem.sa` in two places
(`supabase-shim.js:toEmail()` and the edge function's `toEmail()`), and a value containing `@` is used
as-is. `profiles.id` FKs `auth.users.id` on delete cascade; `profiles.legacy_id` (integer identity,
sequence set past 25) is the id the UI displays and the edge function keys on. Roles are
`admin | callcenter | field` plus `is_blocked`. Helpers `my_role()`, `my_username()`, `is_admin()` are
`security definer` with a fixed `search_path` and treat a blocked account as anonymous (return null).
Migration 002 revoked `EXECUTE` on the trigger functions from everyone and left the three helpers
executable by `authenticated` only; migration 003 rewrote `profiles_select` to use `(select auth.uid())`
and split the site tables' `FOR ALL` admin policy into insert/update/delete.

| Table | admin | field | callcenter | anon |
|---|---|---|---|---|
| `projects` | all | approved + own; insert; update/delete own (delete only if not approved) | select approved only | none |
| `profiles` | select/update all | own row | own row | none |
| `activities` | select all | insert only | insert only | none |
| `site_projects`, `site_settings` | write | read | read | read |

**Server-side guards** — `projects_guard` (BEFORE INSERT/UPDATE) overwrites `added_by`, `employee`,
`date_added`, `status` from `auth.uid()`, and a `field` edit forces the row back to `pending`;
`activities_guard` overwrites `user_id`, `user_name`, `timestamp`. Both bypass when `auth.uid()` is null so
dashboard imports still work. This "the server decides ownership" pattern is the most valuable thing to
copy into the CRM.

**Edge function `admin-users`** — service-role; verifies the caller is an unblocked admin, then
`create | change_password | toggle_block | delete`. Enforces min password 8, role whitelist, unique
username, reuses `legacy_users.id` when the username matches an old employee, rolls back the auth user if
the profile insert fails, blocks self-block/self-delete, bans via `ban_duration: 876000h`. CORS `*`.

**Storage / maps** — one bucket `project-images`, **public = true**; insert for admin+field, delete for
admin, no update policy. Uploads land in `projects/img_<ts>_<rand>.jpg` after client-side canvas
compression; the public URL goes into `projects.images` (jsonb), the bare filename into `image_files`.
Maps are Leaflet + OSM with clustering, click/drag to set coordinates and geolocation centering with a
Riyadh fallback; `latitude`/`longitude` are `double precision` and 110/110 rows have coordinates.

**Data-shape facts that decide the CRM design** — `projects` has **no purpose (sale/rent), no city, no
district, no rooms column**. `address` is free text and in practice holds only the district (`حي الريان`,
`حي الروضة`, …), with whitespace variants of the same district (`حي السلامة` vs `حي السلامة `) and 13
NULLs; 39 distinct values over 110 rows. Rooms, building area, frontage, apartment unit models,
construction status, support type, delivery time and the Drive link all live inside the `details` jsonb.
For `شقة`, `price` and `area` are **derived sums** of `details.models[].price × count`. Unit-level state
exists only as `details.models[].status` (`available|reserved|sold`) — there is no units table.
`deletion_requested` and `deleted_at` are referenced nowhere in `script.js`; `image_files`,
`legacy_users`, `site_projects` and `site_settings` are effectively dormant. Existing timestamp columns
are naive `timestamp` holding Riyadh local time, not `timestamptz`.

## B. What can be reused

**As-is** — Supabase Auth + username→email mapping + `profiles` + the three roles (the CRM needs no new
role: "broker" is the existing `field`); `my_role()`/`my_username()`/`is_admin()` as RLS helpers;
`admin-users` (staff management is complete and needs nothing for the CRM); the guard-trigger pattern;
`projects` as the inventory side of matching, with its coordinates; `project-images` for property photos.

**With a caveat** — `activities` is fine as the staff audit log it already is, but it is not a CRM timeline
(no entity FK, no per-entity index, admin-only SELECT, UI capped at 50 rows): keep it, do not extend it
(G.1). CSS and markup patterns (`.modal`, `.notification`, stat cards, kanban, approval cards, RTL type
scale) are directly copyable. `compressToBlob`/`uploadImageFile` are worth porting as functions; today they
are globals in a 2729-line file.

**Do not reuse** — the shim as an extension point (C); `script.js` functions (no modules, no exports, 54
`innerHTML` interpolations with no escaping); ownership by `added_by TEXT = username` — the CRM owns rows
by `uuid`.

## C. Where the CRM UI should live

**Recommendation: a new `/crm/` section talking to Supabase directly. Leave `index.html`, `script.js` and
the shim untouched.**

1. The shim's contract is "PHP API response shapes" — string numbers, `'1'`/`'0'` booleans. Extending it
   means inventing fake `api/clients.php` endpoints for features that never had a PHP counterpart, and
   re-degrading clean types so one legacy caller stays happy. There is no such caller.
2. `script.js` is a single 2729-line global scope. Adding clients, requirements, pipeline and commissions
   there puts a live inventory system at regression risk for zero benefit.
3. Isolation is free: the shim intercepts only URLs matching `/api/*.php`, so a `/crm/` page is unaffected
   whether or not it loads the shim. Blast radius and rollback are a folder.
4. supabase-js gives server-side filtering, ordering and range pagination. CRM lists (matches, follow-ups,
   deals) must not inherit the "load every row into a global array" pattern.
5. Session is shared for free: same origin, and the shim persists the session in `localStorage` under
   `storageKey: 'mulaem-auth'`. `/crm/` reusing that exact key inherits the logged-in session — no second
   login. Create exactly one client instance per page.

Constraints: `/crm/` must read identity from `supabase.auth.getSession()` + `profiles`, never from
`sessionStorage.currentUser` (client-writable, so gating on it is cosmetic); two code styles to maintain,
acceptable because the legacy side is frozen by design; eventually one link from the dashboard header to
`/crm/`, a one-line `index.html` change deliberately deferred so Phases 0–3 touch no existing file. The
rejected alternative — extending `script.js` through the shim — would be defensible only if the CRM were a
small addition to the property form. It is not; it is a second application.

## D. Proposed database design (DDL sketch — not applied)

### D.0 Prerequisite: normalize the inventory

Deterministic matching needs hard filters on purpose/type/city, none of which exist today. Additive
nullable columns on `projects` are safe: the shim's `projectOut` maps an explicit column list (extras are
dropped) and `projectIn` writes an explicit key list, so a legacy edit cannot null them out.

```sql
alter table public.projects
  add column if not exists purpose text check (purpose in ('sale','rent')),
  add column if not exists city text, add column if not exists district text,
  add column if not exists rooms integer, add column if not exists delivery_date date,
  add column if not exists rega_ad_license text, add column if not exists listing_expires_at date;
create index on public.projects (purpose, type, city);
create index on public.projects (district);
-- trigger, after projects_guard: when city/district/rooms are null, derive from btrim(address)
-- (strip the "حي " prefix, collapse whitespace) and details->>'rooms'. Never overwrites an explicit value.
-- backfill: purpose='sale', district=normalized(address), rooms=details->>'rooms', and one city value
-- (confirm with the business which one before running).
```

### D.1 Clients, requirements, matching

```sql
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null, phone text not null,   -- phone normalized to E.164 by trigger
  phone_alt text, email text, city text, notes text,
  source text,                                    -- إعلان / توصية / اتصال / معرض
  client_type text check (client_type in ('buy','rent','sell','invest')),
  status text not null default 'active' check (status in ('active','inactive','blacklist')),
  owner_id uuid not null references public.profiles(id),     -- set by trigger
  created_by uuid not null references public.profiles(id),   -- set by trigger
  whatsapp_opt_in boolean not null default false, preferred_channel text,  -- reserved, unused
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
create unique index clients_phone_uk on public.clients (phone);
create table public.client_requirements (         -- one client, many requirements over time
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  purpose text not null check (purpose in ('sale','rent')),
  property_type text not null,                    -- same vocabulary as projects.type
  city text not null, districts text[] not null default '{}',
  budget_min numeric(14,2), budget_max numeric(14,2),
  area_min numeric(10,2), area_max numeric(10,2),
  rooms_min integer, delivery_before date,
  financing_type text,                            -- نقد / تمويل / مدعوم
  priority smallint not null default 2,           -- 1 high .. 3 low
  status text not null default 'open' check (status in ('open','matched','won','closed')),
  closed_reason text, notes text,
  owner_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now());
create index on public.client_requirements (client_id, status);
create index on public.client_requirements (purpose, property_type, city) where status = 'open';
create table public.crm_settings (key text primary key, value jsonb not null);  -- tunable weights
-- seed ('match_weights', '{"district":35,"budget":30,"area":20,"rooms":10,"delivery":5}')

create table public.property_matches (            -- only acted-on matches are persisted
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.client_requirements(id) on delete cascade,
  project_id integer not null references public.projects(id) on delete cascade,
  unit_key text,                                  -- details.models[].name; null = whole project
  score numeric(5,2) not null, score_breakdown jsonb not null default '{}',
  state text not null default 'suggested' check (state in ('suggested','shared','viewed','rejected')),
  rejected_reason text, created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (requirement_id, project_id, unit_key));
```

Matching itself is a function, not a table:

```sql
create function public.match_requirement(p_requirement uuid)
returns table (project_id int, score numeric, breakdown jsonb)
language sql stable security invoker as $fn$ ... $fn$;
-- hard  : purpose, type, city, status='approved', deleted_at is null, availability='available',
--         (listing_expires_at is null or >= current_date)   scored: district ∈ districts,
--         budget in range, area, rooms_min, delivery_date
```

`security invoker` keeps RLS applying, so a broker only ever matches against inventory they may already see.

### D.2 Follow-ups, timeline, deals, commissions

```sql
create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  requirement_id uuid references public.client_requirements(id) on delete set null,
  deal_id uuid references public.deals(id) on delete set null,
  assigned_to uuid not null references public.profiles(id), due_at timestamptz not null,
  channel text not null check (channel in ('call','whatsapp','visit','other')),
  purpose text, outcome text, done_at timestamptz,
  status text not null default 'pending' check (status in ('pending','done','cancelled')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now());
create index on public.follow_ups (assigned_to, status, due_at);

create table public.crm_events (     -- append-only; separate from the legacy `activities` audit log
  id bigint generated always as identity primary key,
  entity_type text not null check (entity_type in
    ('client','requirement','deal','property','follow_up','commission')),
  entity_id text not null,
  event_type text not null,                     -- created / stage_changed / matched / called / ...
  payload jsonb not null default '{}',
  actor_id uuid not null references public.profiles(id),   -- set by trigger
  created_at timestamptz not null default now());
create index on public.crm_events (entity_type, entity_id, created_at desc);
```

```sql
create table public.deal_stages (
  id smallint primary key, key text unique not null, name_ar text not null,
  sort_order smallint not null,
  is_terminal boolean not null default false, is_won boolean not null default false);
-- seed: 1 new · 2 viewing · 3 negotiation · 4 deposit · 5 contract · 6 closed_won · 7 closed_lost
create table public.lost_reasons (id smallint generated always as identity primary key,
  name_ar text not null, is_active boolean not null default true);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  requirement_id uuid references public.client_requirements(id),
  project_id integer references public.projects(id), unit_key text,
  broker_id uuid not null references public.profiles(id),
  stage_id smallint not null references public.deal_stages(id) default 1,
  amount numeric(14,2), expected_close_date date,
  lost_reason_id smallint references public.lost_reasons(id), lost_note text,
  opened_at timestamptz not null default now(), closed_at timestamptz,
  created_by uuid not null references public.profiles(id),
  constraint deals_lost_reason_required check (stage_id <> 7 or lost_reason_id is not null));
create index on public.deals (broker_id, stage_id);
create index on public.deals (client_id);

create table public.deal_stage_history (        -- written by an AFTER UPDATE trigger only
  id bigint generated always as identity primary key,
  deal_id uuid not null references public.deals(id) on delete cascade,
  from_stage smallint, to_stage smallint not null, note text,
  changed_by uuid not null references public.profiles(id),
  changed_at timestamptz not null default now());

create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null unique references public.deals(id) on delete restrict,
  base_amount numeric(14,2) not null,           -- sale value
  rate_percent numeric(5,2) not null default 2.5, vat_rate numeric(5,2) not null default 15,
  gross_amount numeric(14,2) generated always as (base_amount * rate_percent / 100) stored,
  vat_amount numeric(14,2) generated always as
    (base_amount * rate_percent / 100 * vat_rate / 100) stored,
  company_share numeric(14,2) not null default 0, broker_share numeric(14,2) not null default 0,
  external_share numeric(14,2) not null default 0, external_party text,
  status text not null default 'due'
    check (status in ('due','invoiced','partial','collected','waived')),
  collected_amount numeric(14,2) not null default 0,
  collected_at date, invoice_no text, notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint shares_balance check
    (company_share + broker_share + external_share <= base_amount * rate_percent / 100 + 0.01));
```

Inventory quality is views, not tables: `v_inventory_expiring` (`listing_expires_at` past or within 30
days, or missing `rega_ad_license`) and `v_inventory_duplicates` (same `type + district + price`, or a
`round(latitude,4)`/`round(longitude,4)` collision). Declare both `security_invoker = true` so RLS still
applies per role.

### D.3 Relationships and RLS model

```
profiles ─owns─> clients ─1:N─> client_requirements ─1:N─> property_matches ─> projects
                    ├─1:N─> follow_ups  (also → requirement, deal)
                    └─1:N─> deals ─1:N─> deal_stage_history · →deal_stages/lost_reasons · 1:1→ commissions
crm_events (entity_type, entity_id) — polymorphic, append-only, points at all of the above
```

Default deny: `revoke all ... from anon`, explicit grants to `authenticated`, then per-operation policies.
Wrap `auth.uid()` as `(select auth.uid())` — the precedent set by migration 003.

```sql
create function public.crm_owns_client(p_client uuid) returns boolean   -- mirrors is_admin()'s style
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.clients c where c.id = p_client
    and (c.owner_id = (select auth.uid()) or c.created_by = (select auth.uid()))) $fn$;
revoke execute on function public.crm_owns_client(uuid) from public, anon;   -- then grant to authenticated
```

| Table | admin | field (broker) | callcenter |
|---|---|---|---|
| `clients` | all | select/insert/update where owner or creator; no delete | select/insert where creator or assigned; update own; no delete |
| `client_requirements` | all | via `crm_owns_client(client_id)` | insert + select via `crm_owns_client`; no update once a deal exists |
| `property_matches` | all | via parent requirement | select only |
| `follow_ups` | all | select/insert/update where `assigned_to` or `created_by` = uid | same |
| `crm_events` | select all | select where the parent entity is visible; **insert via trigger only** | same |
| `deals` | all | select/insert/update where `broker_id` = uid | **no grant at all** |
| `deal_stages`, `lost_reasons` | write | select | select |
| `commissions` | all | select where `deals.broker_id` = uid; no insert/update | **no grant at all** |
| `crm_settings` | write | select | select |

`owner_id`, `created_by`, `actor_id` and `broker_id`-on-insert are forced by BEFORE triggers from
`auth.uid()`, exactly like `projects_guard` — never trusted from the client. `is_blocked` is honoured
automatically because the helpers return null for a blocked account.

## E. Risks and mitigations

1. **Breaking the live inventory.** Additive-only migrations; never alter an existing policy, trigger or
   column type. Test each on a Supabase branch, then apply.
2. **Migration drift — 2 of 3 applied migrations are not in the repo,** so the repo is no longer the schema
   of record. Export 002/003 before writing any new DDL.
3. **Two ownership models.** `projects.added_by` is a username string; the CRM uses uuid. Never let
   usernames be renamed — today a rename silently orphans every project that person added (latent
   pre-existing bug). Join to `projects` via `added_by → profiles.username`.
4. **Client PII leakage.** `clients` holds phone numbers and `callcenter` is the widest-read role.
   Default-deny plus per-role policies, and extend the existing RLS test practice (24 cases today) with a
   CRM matrix: anon, admin, field A, field B, callcenter, blocked.
5. **Stored XSS.** 54 unescaped `innerHTML` interpolations in `script.js`; a field user's project name
   already reaches the admin's approvals view unescaped. The CRM adds far more client-entered free text, so
   `/crm/` must use `textContent` or one escape helper — no exceptions for notes, names, lost reasons.
6. **Matching on unstructured data.** `address` is free text with whitespace variants. Normalize first
   (D.0), keep hard filters in SQL, keep weights in `crm_settings`.
7. **Public storage bucket.** `project-images` is world-readable by URL. Client ID documents and contracts
   need a separate private bucket (`crm-docs`) with signed URLs.
8. **The publishable key is public; RLS is the only guard.** Design every CRM table assuming a hostile
   authenticated callcenter user calling PostgREST directly, not a hostile UI.
9. **Scale.** Follow-ups and events grow much faster than 110 properties. Paginate with `.range()` from day
   one; index every column used in a policy or an order-by.
10. **Financial data with no stated backup policy.** Enable PITR (or scheduled dumps) before commissions go
    live; keep `deal_stage_history` and `crm_events` append-only.
11. **Advisor warnings.** `is_admin`/`my_role`/`my_username` are callable via `/rest/v1/rpc` (low impact —
    they reveal only the caller's own role), and leaked-password protection is disabled. Enable the latter;
    put new CRM helpers in a non-exposed schema or revoke as above.
12. **Single admin account** (`profiles` has 1 row): one blocked or lost account freezes approvals and
    commissions. Create a second admin before the system handles money.
13. **Timestamp mismatch.** Existing columns are naive `timestamp` in Riyadh local time; CRM tables use
    `timestamptz`. Reports joining `projects.date_added` to CRM timestamps must convert, or drift 3 hours.

## F. Phase sequence and acceptance tests

| # | Phase | Acceptance test |
|---|---|---|
| 0 | Parity and guardrails: export migrations 002/003 to the repo, enable leaked-password protection, add a second admin, open a Supabase branch | Migration list matches `supabase/migrations/`; login and dashboard behave exactly as before; `node tests/shim.test.js` → 31 pass |
| 1 | Inventory normalization (additive columns + backfill + trigger) | 110/110 projects have non-null `purpose`, `city`, `district`; the dashboard lists the same 110; add/edit/approve/reject still work; a legacy edit does **not** null the new columns; shim tests still 31 pass |
| 2 | `clients` + `client_requirements` + the `/crm/` shell | Field user A cannot read field user B's client through a direct PostgREST call; callcenter can create a client but `select * from commissions` is denied; admin sees all; `/crm/` loads with no second login on the existing `mulaem-auth` session |
| 3 | Matching function + match screen (read-only) | A requirement for `sale / شقة / <city>` returns only rows passing every hard filter, ordered by descending score, under 300 ms; changing a weight in `crm_settings` reorders results with no deploy; a broker never sees a property they lack access to |
| 4 | Follow-ups + timeline | Creating a follow-up writes exactly one `crm_events` row whose `actor_id` is the caller even when the client sends a different one; a field user's overdue list contains only their own items |
| 5 | Deals, stages, lost reasons | Every stage change inserts one `deal_stage_history` row; `closed_lost` without a `lost_reason_id` is rejected by the constraint; a field user cannot update another broker's deal |
| 6 | Commissions | VAT and gross are computed by the DB and cannot be overridden from the client; shares exceeding the gross are rejected; a field user sees only their own rows; the admin total equals the sum of `collected_amount` |
| 7 | Management dashboard and funnel (views only) | Funnel counts reconcile with raw table counts for a chosen month; the same view run by a field user returns only their slice (`security_invoker`) |
| 8 | Inventory quality (expiry, duplicates, REGA licence) | A seeded duplicate pair appears in `v_inventory_duplicates`; a project with a past `listing_expires_at` shows in the expiry list and is excluded from Phase 3 matching |
| 9 | Later: public site, WhatsApp, AI | Nothing built now; `whatsapp_opt_in`, `preferred_channel`, `crm_events.payload` and `property_matches.score_breakdown` already let these attach without migrating existing tables |

## G. Unnecessary, or in conflict with the current system

1. **A second activity timeline overlapping `activities`.** `activities` already logs staff actions
   (admin-only, 50-row UI cap, no entity FK). Do not extend it and do not mirror it — keep it as the legacy
   audit log, put CRM events in `crm_events`, and never show both on the same admin screen.
2. **Persisting every requirement × property match.** Unnecessary and quadratic. Compute on demand; persist
   a row only when a match is shared, viewed or rejected.
3. **Weighting "delivery" today.** `details.delivery_time` is free text (`بعد 16 شهر`, `منتصف 2026`) and
   only present for under-construction properties. Populate the real `delivery_date` column first, or drop
   delivery from the weights until the data exists.
4. **A hard filter on city, right now.** No city value exists — `address` holds the district only and the
   inventory appears to be a single city, so before the Phase 1 backfill a city hard filter returns zero
   rows. Until then, hard-filter on purpose + type only.
5. **Unit-level matching for apartments in v1.** Units live inside `details.models` jsonb, not rows;
   matching "3 rooms" means unnesting jsonb per project. Either accept project-level matching for v1 or
   promote models to a `property_units` table — which changes the meaning of `projects.price` and
   `projects.area` (they are sums of the models) and must not be a first-phase change.
6. **Merging the deal pipeline with the existing kanban.** `renderKanbanBoard` is an inventory board of
   units, not a sales pipeline. Same word, different object. Keep them separate.
7. **Inventory availability vs deal stage will disagree.** `projects.availability` and
   `details.models[].status` already encode sold/reserved. Recommended rule: a trigger on deal stage change
   that *flags* the property for the admin rather than silently writing `availability`, which would
   surprise the approval workflow.
8. **Extending the shim with CRM endpoints.** A translation layer with no legacy caller (see C).
9. **Building on `deletion_requested` / `deleted_at` / `image_files`.** Dead columns with zero UI
   references. Do not design around them; do not drop them while `001_init.sql` is the schema of record.
10. **Adding a "broker" role.** A fourth role means touching the `profiles` CHECK constraint, the edge
    function's `ROLES` array and every existing policy. Reuse `field`.
