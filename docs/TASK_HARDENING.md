# Task: phase 1 — fix the foundation (verified defects only)

Same hard rules as the previous tasks (`el()`/`textContent` only inside `crm/`, `.range()` pagination, Arabic errors
via `errorText`, `.select('id')` on updates). Read `docs/ROADMAP.md` first — it is the ordering contract and records
which review findings were verified true and which were not. **Do not** work on the items this file does not list:
the import centre, WhatsApp, client offer pages and the manager assistant are later phases with their own task files.

Every defect below was verified against the live database on 2026-09-18 before this file was written. The two review
findings that turned out to be false (suspended accounts, "deals/commissions UI missing") are not in scope — do not
"fix" them.

One migration file, `supabase/migrations/009_hardening.sql`, applied with the Supabase MCP under the migration name
`hardening`, committed in the first commit. One commit per group, push at the end. Run the headless-Chrome harness
for the three roles plus the pages you touch, then delete the harness files before pushing.

## 1. Stored XSS in the legacy dashboard (commit: "Dashboard: escape data in innerHTML")

`js/script.js` interpolates database text straight into `innerHTML` — `project.name`, `project.address`,
`project.type`, `project.employee`, `project.added_by`, `project.notes`, `rejection_reason`, unit-model names, user
`fullname`/`username`, activity text, and the modal body. A project name containing `<img src=x onerror=…>` runs for
every user who loads the grid. This is the legacy file only; `crm/` uses `textContent` and is not affected.

- Add one helper near the top of `js/script.js`:
  ```js
  function esc(v) {
      if (v === null || v === undefined) return '';
      return String(v).replace(/[&<>"']/g, function (c) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
  }
  ```
- Wrap **every** interpolation of database-sourced text in `esc(...)`, including inside `title=""`/`alt=""`
  attributes and the map popups. Numbers passed to `onclick="viewProject(${project.id})"` stay as they are only
  where the value is a number from the database — if it is `text`, escape it.
- Image URLs: `src="${firstImage}"` must be rejected unless it starts with `https://`; otherwise render the
  placeholder. (A `javascript:` URL in `images` is the same hole.)
- Do not restructure the file, do not convert it to `el()`, do not touch the layout.

## 2. Event log integrity (in `009_hardening.sql`, commit: "DB: event log integrity")

The insert policy on `crm_events` accepts any `event_type` and any `payload`, so a broker can write a fake
`commission_collected` row into the audit trail. The only direct insert the UI performs is the manual note in
`crm/js/timeline.js` (`entity_type: 'note'`, `event_type: 'note'`), so restricting the policy needs no UI change.
The trigger functions are `security definer` owned by `postgres` and the table is not `force row level security`,
so trigger-written events are unaffected — verify that after applying.

```sql
drop policy if exists crm_events_insert on public.crm_events;
create policy crm_events_insert on public.crm_events for insert to authenticated
with check (
    public.my_role() is not null
    and entity_type = 'note' and event_type = 'note'
    and client_id is not null and public.crm_can_see_client(client_id)
);
```

The select policy leaks commission amounts: anyone who can see the client sees `commission_recorded` /
`commission_collected` payloads, and a blocked user still reads the events they authored.

```sql
drop policy if exists crm_events_select on public.crm_events;
create policy crm_events_select on public.crm_events for select to authenticated
using (
    public.is_admin()
    or (
        public.my_role() is not null
        and (actor_id = (select auth.uid()) or (client_id is not null and public.crm_can_see_client(client_id)))
        and event_type not like 'commission%'
    )
);
```

Brokers still read their own commissions through the `commissions` table (`crm_can_see_deal`), so nothing they are
entitled to disappears — only the duplicated amounts in the timeline. Check `crm/js/timeline.js` still renders
without gaps for a broker.

## 3. Commission lifecycle (in the same migration, commit: "DB: commission lifecycle")

`deals_after()` creates the commission only when `stage_id` *changes* to a won stage and `amount` is already set.
Three paths therefore produce a won deal with no commission, or a commission on a stale base:

1. a deal **inserted** directly at stage 6 (تمت),
2. a deal that reached stage 6 with `amount` null, then had the amount filled in,
3. a won deal whose `amount` is later edited — `commissions.base_amount` keeps the old value.

Rewrite `deals_after()` so the commission logic runs on both INSERT and UPDATE, driven by the current row:

- if the stage is won and `new.amount is not null`: `insert into commissions (deal_id, base_amount, created_by)
  … on conflict (deal_id) do nothing`, and emit the existing `property_sold_flag` event when the commission row is
  actually created (not on every update).
- if a commission already exists and `new.amount is distinct from old.amount`:
  - when that commission has **no** money against it (`collected_amount = 0` and `status in ('due','invoiced')`):
    update `base_amount` and emit `commission_base_updated` with `{old, new}`.
  - otherwise (collected, partially collected, or waived): **do not touch the financial record.** Set
    `needs_review = true` on the commission and emit `commission_base_mismatch` with `{old, new, deal_id}`.
- keep `deal_opened` / `deal_stage_changed` exactly as they are.

Add the column:

```sql
alter table public.commissions add column if not exists needs_review boolean not null default false;
```

Admins clear it from the commission card (a "تمت المراجعة" button setting `needs_review = false`); the button is
admin-only and shows only while the flag is true. Show a badge "الأساس تغيّر — يحتاج مراجعة" (orange) on the deal
page commission card and in the `#/commissions` table for flagged rows.

## 4. Payments ledger (same migration, commit: "DB+CRM: commission payments ledger")

`commissions.collected_amount` is a single number with a single `collected_at`, so two payments in different months
both land in the month collection was completed and `v_funnel_monthly.commission_collected` is wrong.

```sql
create table if not exists public.commission_payments (
    id            uuid primary key default gen_random_uuid(),
    commission_id uuid not null references public.commissions(id) on delete cascade,
    amount        numeric(14,2) not null check (amount > 0),
    paid_on       date not null default current_date,
    method        text check (method is null or method in ('bank','cash','cheque','other')),
    note          text,
    created_by    uuid references public.profiles(id),
    created_at    timestamptz not null default now()
);
create index if not exists commission_payments_idx on public.commission_payments (commission_id, paid_on);
```

- `collected_amount` and `collected_at` become **derived**: in `commissions_guard()` always recompute them from the
  ledger (`sum(amount)`, `max(paid_on)`) and ignore whatever the client sent, so a direct write cannot forge a
  collection. The existing status derivation stays as it is.
- A trigger on `commission_payments` (insert/update/delete) touches the parent commission so the guard reruns.
- Backfill: for every commission with `collected_amount > 0`, insert one payment row with that amount and
  `paid_on = coalesce(collected_at, current_date)`, `note = 'ترحيل رصيد سابق'`. Do this **before** the guard change
  takes effect on existing rows, and verify totals are unchanged afterwards.
- RLS: admin full write; broker reads payments of commissions they can already see (`crm_can_see_deal` via the
  parent). No insert for non-admins. `revoke all … from anon`.
- Events: emit `commission_payment_added` (payload `{amount, paid_on}`) from a trigger, so the audit trail keeps
  the history. It matches `commission%`, so the policy in group 2 already restricts it to admins.
- `v_funnel_monthly.commission_collected` must aggregate `commission_payments.paid_on` by month, not `collected_at`.

UI (`crm/js/commission.js`): remove the `collected_amount` input from the admin form — it is derived now. Put a
payments table under the commission card (date, amount, method, note, who added it) with an admin-only
"إضافة دفعة" form (amount with `parseNumber`, date, method select, note). Show المحصَّل and المتبقي from the
commission row. `#/commissions` keeps working unchanged.

## 5. Tests (report the output)

Run as SQL with role simulation (`set_config('request.jwt.claims', …)` + `set local role authenticated`), inside a
transaction that raises at the end so nothing persists — the same pattern as the earlier rounds. Cover:

1. broker inserting `event_type = 'commission_collected'` → refused; inserting a note → accepted.
2. broker selecting `crm_events` for their own client → no `commission%` rows; admin → sees them.
3. blocked user (`is_blocked = true`) selecting `crm_events` → zero rows.
4. deal inserted directly at stage 6 with an amount → commission row exists.
5. deal reaching stage 6 with `amount` null, then amount set → commission row created at that moment.
6. won deal with an uncollected commission, amount edited → `base_amount` follows, `commission_base_updated` logged.
7. same with one payment recorded → `base_amount` unchanged, `needs_review = true`, `commission_base_mismatch` logged.
8. two payments in different months → `v_funnel_monthly` attributes each to its own month; `collected_amount` equals
   their sum; status becomes `collected` only when the sum reaches the gross.
9. non-admin inserting into `commission_payments` → refused.
10. XSS: a project whose name is `<img src=x onerror=alert(1)>` renders as text in the grid, the modal and the map
    popup (check the harness DOM for an `img` element created from the name — there must be none).

## Finish

Push and report the commit hashes, the test output for all ten checks, and anything you could not verify.
