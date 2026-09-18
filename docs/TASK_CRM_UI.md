# Task: build the Mulaem CRM front-end (`/crm/`) — phases 2, 3 and 4

You are working in the `mulaem-dash` repository. Read `docs/AUDIT.md` first (sections A, C and D) — it describes
the current system. The database side of phases 1–4 is **already applied to the live Supabase project** and
recorded in `supabase/migrations/004_inventory_normalization.sql` and `005_crm_core.sql`. Read both files:
they are the exact data contract you build against. Do not modify the database.

## Hard rules

1. Do not modify any existing file: `index.html`, `js/script.js`, `js/supabase-shim.js`, `js/config.js`,
   `css/style.css`, `tests/`, `supabase/`. Everything new lives under `crm/`.
2. Static files only, no build step, no framework. Vanilla JS (ES modules are fine), HTML, CSS. Arabic RTL.
3. Never render user-entered text with `innerHTML` interpolation. Use `textContent`, or one `esc()` helper
   applied to every interpolated value.
4. Every list query uses server-side filtering/ordering and `.range()` pagination (page size 25). Never load a
   whole table into memory.
5. Identity comes only from `supabase.auth.getSession()` + the caller's `profiles` row. Role checks in the UI
   are cosmetic; the database enforces everything through RLS and triggers. So: on any error from Supabase,
   show the message to the user in Arabic and do nothing else.
6. Commit and push after each phase (three commits), plus one initial commit that adds the four migration
   files already present in `supabase/migrations/` (002–005). Never commit secrets; `js/config.js` holds only
   the publishable key and is already committed.

## Files to create

- `crm/index.html` — single page app shell: header (logo from `../images/logo.jpg`, user name, role, logout),
  navigation, and one `<main>` that the router fills.
- `crm/crm.css` — link `../css/style.css` first (reuse its variables, `.modal`, `.notification`, stat cards,
  buttons, RTL type scale), then only the overrides `/crm/` needs.
- `crm/js/supabase.js` — creates ONE client:
  `createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'mulaem-auth' } })`
  where `cfg = window.MULAEM_CONFIG` loaded from `../js/config.js`. The `storageKey` must be exactly
  `mulaem-auth` so a user already logged into the dashboard is logged into the CRM with no second login.
  Load supabase-js v2 from the same CDN as `index.html`. Do NOT load `supabase-shim.js` or `script.js`.
- `crm/js/auth.js` — session, profile (`select id, legacy_id, username, fullname, role, is_blocked from profiles
  where id = session.user.id`), login form for the no-session case (username → email:
  `username.includes('@') ? username : username + '@' + (cfg.AUTH_EMAIL_DOMAIN || 'users.mulaem.sa')`, then
  `signInWithPassword`), logout (`signOut`).
- `crm/js/app.js` — hash router (`#/work`, `#/clients`, `#/clients/:id`, `#/clients/:id/requirements/:rid`),
  plus modules per screen (split files as you see fit under `crm/js/`).

## Data contract (from 005_crm_core.sql — read it, this is a summary)

Tables (all under RLS): `clients`, `client_requirements`, `property_matches`, `follow_ups`, `crm_events`,
`crm_settings`. Views: `v_units`, `v_my_work`. RPCs: `match_requirement(p_requirement uuid)`, `crm_staff()`.

- `clients`: `id, full_name, phone, phone_alt, email, source, client_type ('buy'|'rent'|'sell'|'invest'), city,
  status ('active'|'inactive'|'blacklist'), owner_id, created_by, notes, created_at, updated_at`.
  Never send `created_by`; the server sets it. `owner_id`: a `field` user cannot set it (server forces
  self); `admin`/`callcenter` may set it on create (assignment); only `admin` may change it later.
  Phone: accept whatever the user types (05xxxxxxxx works); the server normalizes to +966… and enforces
  uniqueness — on error code `23505` show "العميل موجود مسبقاً" and offer to open the existing client
  (look it up by the normalized phone via `select id from clients where phone = …`; if RLS hides it, say the
  client belongs to another broker).
- `client_requirements`: `id, client_id, purpose ('sale'|'rent'), property_type (same words as
  `projects.type`, e.g. شقة / فيلا), city, districts text[], budget_min, budget_max, area_min, area_max,
  rooms_min, delivery_before, financing_type, priority (1..3), status ('open'|'matched'|'won'|'closed'),
  closed_reason, notes`. Server sets `owner_id`, `created_by`, and `city` when omitted.
  Options for the form: districts = `select district from projects where district is not null` distinct,
  sorted by frequency; property types = distinct `projects.type`.
- `match_requirement(p_requirement)` returns rows: `project_id, project_name, unit_key, unit_ord, district,
  district_inferred, price, area, rooms, bathrooms, construction_status, score (0–100), breakdown (jsonb with
  district/budget/area/rooms/delivery each 0..1)`. Call it with
  `supabase.rpc('match_requirement', { p_requirement: id })`. Score labels: ≥ 85 "مطابقة ممتازة",
  ≥ 70 "مطابقة جيدة", otherwise "مطابقة محتملة". Show a small "الحي مستنتج" badge when `district_inferred`.
- `property_matches` (persisted only when acted on): insert
  `{ requirement_id, project_id, unit_key, score, score_breakdown, state: 'shared' }`; later update
  `state` to `'interested' | 'not_interested' | 'viewing'` and optional `note`. Unique per
  (requirement, project, unit) — on `23505` just update the existing row instead.
- `follow_ups`: `id, client_id, requirement_id, assigned_to, due_at (timestamptz), channel
  ('call'|'whatsapp'|'visit'|'other'), purpose, outcome, status ('pending'|'done'|'cancelled'), done_at`.
  A `field` user is always the assignee (server forces it); admin/callcenter may pick an assignee from
  `crm_staff()`. Marking done: update `{ status: 'done', outcome }`.
- `crm_events`: read-only timeline for the client page: `select * from crm_events where client_id = …
  order by created_at desc` with `.range()`. Map `actor_id` to a name using `crm_staff()` (cache it once per
  session). Also allow a manual note: insert `{ client_id, entity_type: 'note', event_type: 'note',
  payload: { text } }`. Render event types in Arabic (client_created, client_reassigned,
  client_status_changed, requirement_created, requirement_status_changed, match_shared, match_interested,
  match_not_interested, match_viewing, follow_up_scheduled, follow_up_done, follow_up_cancelled, note).
- `v_my_work`: one row: `follow_ups_today, follow_ups_overdue, new_requirements_7d, viewings_today,
  active_clients` — already filtered to what the caller may see.
- `crm_staff()`: `id, legacy_id, username, fullname, role` of active staff (for assignee dropdowns and names).

## Phase 2 — clients and requirements (commit: "CRM phase 2: clients and requirements")

Screens:
1. `#/clients` — search box (name or phone; use `.or('full_name.ilike.%q%,phone.ilike.%q%')`), status filter,
   paginated table (name, phone, type, owner name, status, last update), "عميل جديد" button opening the
   client form.
2. Client form (create/edit) — full_name, phone, phone_alt, email, source (select: إعلان / توصية / اتصال /
   معرض / موقع / واتساب / أخرى), client_type, city (default from `crm_settings` key `default_city`), notes;
   owner select shown only for admin/callcenter, populated from `crm_staff()` where role = 'field'.
3. `#/clients/:id` — header with client data and an edit button; tabs: الطلبات, المتابعات, السجل.
   Requirements tab: list of the client's requirements (purpose, type, districts, budget range, status) and
   "طلب جديد" form with all requirement fields; districts as a multi-select of checkboxes; budget inputs
   formatted with thousands separators on blur.

Acceptance (do these yourself before committing, then list them in the commit message body):
- Opening `crm/index.html` on the deployed site while logged into the dashboard shows the CRM with no login.
- With no session, the login form works with the same username/password as the dashboard.
- Creating a client with phone `0501234567` stores it as `+966501234567` (read it back and show it).
- Creating the same phone twice shows "العميل موجود مسبقاً".
- A requirement created for a client appears in the client's list and creates a timeline event.

## Phase 3 — matching (commit: "CRM phase 3: property matching")

On `#/clients/:id/requirements/:rid`: requirement summary, a "ابحث عن مطابقات" button that calls
`match_requirement`, and a results table (project name, unit, district + inferred badge, price, area, rooms,
construction status, score badge). Per row: "مشاركة مع العميل" (insert `property_matches` state `shared`).
Below it, "المطابقات المحفوظة" for this requirement from `property_matches` with state buttons: مهتم / غير مهتم /
معاينة, and an optional note. Rows marked `not_interested` disappear from future search results (the RPC
excludes them).

Acceptance:
- A requirement `sale / شقة / جدة / districts [السلامة, الروضة] / budget 600,000–800,000 / rooms ≥ 4` returns
  results ordered by score, top score ≥ 85.
- Sharing a result persists a `property_matches` row and shows a `match_shared` event on the client timeline.
- Marking a row `not_interested` removes it from the next search.

## Phase 4 — follow-ups and "عملي اليوم" (commit: "CRM phase 4: follow-ups and my work")

1. Client page, tab المتابعات: list (due, channel, purpose, status, assignee) + "متابعة جديدة" form
   (date + time → `due_at` ISO string with the local offset, channel, purpose, optional requirement, assignee
   dropdown only for admin/callcenter). "تم" button asks for the outcome and updates status to `done`.
2. `#/work` (the default route): five stat cards from `v_my_work`, then two lists: "متابعات اليوم"
   (`follow_ups` where status = pending and due today, with client name via
   `select *, client:clients(full_name, phone)`), and "متأخرة" (due before today), each row with a "تم"
   button and a link to the client. Admin sees everyone's; a field user sees only their own — this is
   automatic through RLS, do not filter by user in the UI.

Acceptance:
- A follow-up due today appears in "متابعات اليوم"; marking it done moves it out and writes a
  `follow_up_done` event.
- `v_my_work.follow_ups_today` matches the list length.

## Finish

Push after the last commit and report: the three commit hashes, the CRM URL
(`https://mohammedalseari-design.github.io/mulaem-dash/crm/`), and anything you could not verify.
Do not add a link from the old dashboard to `/crm/` — that one-line change is a separate, later decision.
