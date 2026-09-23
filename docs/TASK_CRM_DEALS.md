# Task: CRM phases 5–7 — deal pipeline, commissions, management dashboard

Same hard rules as `docs/TASK_CRM_UI.md` and `docs/TASK_CRM_FIXES.md` (everything under `crm/`; `el()`/`textContent`
only; server-side filters with `.range()`; `.select('id')` on every update and treat zero rows as "لا تملك صلاحية";
Arabic error mapping via `errorText`). The database side is already live and recorded in
`supabase/migrations/007_deals_commissions.sql` — read it first; it is the contract. Commit the new migration file
in the first commit. One commit per group, push at the end. Run your headless-Chrome syntax/render checks again
before the final push, then delete the harness files.

## Data contract (summary — the SQL file is authoritative)

- `deal_stages` (read for all staff): `id, key, name_ar, sort_order, is_terminal, is_won`. Seeded 1..7:
  اهتمام جدي, معاينة, تفاوض, عربون, عقد وإفراغ, تمت (won), خسرت (lost).
- `lost_reasons` (read for all staff): `id, key, name_ar, is_active`.
- `deals`: `id, client_id, requirement_id, project_id, unit_key, broker_id, stage_id, amount, expected_close_date,
  lost_reason_id, lost_note, opened_at, closed_at`. Server sets `created_by`, forces `broker_id` for `field`
  users, sets `closed_at` on terminal stages, clears lost fields when leaving stage 7. Moving to stage 7 without
  `lost_reason_id` fails with a check-constraint error (`23514`) — the UI must require a reason first.
  `callcenter` has no access to deals at all (hide the UI for that role; the DB refuses anyway).
- `deal_stage_history` (read-only, written by trigger): `deal_id, from_stage, to_stage, note, changed_by, changed_at`.
- `commissions` (admin writes, broker reads own): `deal_id (unique), base_amount, rate_percent (default 2.5),
  vat_rate (default 15), gross_amount + vat_amount (computed by DB, read-only), company_share, broker_share,
  external_share, external_party, status ('due'|'invoiced'|'partial'|'collected'|'waived'), collected_amount,
  collected_at, invoice_no, notes`. The DB auto-creates a commission row when a deal with an `amount` reaches
  stage 6, and derives `status` from `collected_amount` (partial/collected) unless `waived`. Shares above the
  gross are rejected (`23514`).
- Views (all RLS-aware): `v_funnel_monthly` (12 rows, newest first: month, new_clients, new_requirements,
  requirements_matched, viewings, negotiations, won, lost, commission_gross, commission_collected),
  `v_broker_performance` (one row per broker: active_clients, open_requirements, follow_ups_done_30d,
  follow_ups_overdue, shared_30d, deals_open, won_90d, lost_90d, commission_gross_90d, broker_share_90d),
  `v_lost_reasons_90d` (reason, deals).
- New timeline event types to render in Arabic: `deal_opened`, `deal_stage_changed` (payload.stage), `property_sold_flag`
  ("العقار بيع فعلياً — راجع حالته في اللوحة"), `commission_recorded`, `commission_due|invoiced|partial|collected|waived`.

## 1. Deals on the client page and a pipeline board (commit: "CRM phase 5: deal pipeline")

- Client page, new tab **الصفقات**: list of the client's deals (stage badge, project/unit, amount, broker, opened,
  expected close). "صفقة جديدة" form: requirement (optional, from the client's requirements), project + unit
  (optional; when opened from a match row, prefill project_id/unit_key/requirement_id), amount, expected close
  date; broker select only for admin (from `crm_staff()` role field).
- On a match row (matching page) add a button "فتح صفقة" that opens the same form prefilled.
- Deal page `#/deals/:id`: header, stage stepper (1..5 then تمت/خسرت), "الانتقال إلى" action per next stage;
  choosing خسرت opens a small form requiring `lost_reason_id` (from `lost_reasons` where is_active) and optional
  `lost_note`; choosing تمت asks to confirm the final `amount` if empty. Below: stage history (from
  `deal_stage_history`, names via `crm_staff()`), and the commission card (read-only for brokers; see group 2).
- Route `#/deals` (nav item "الصفقات", hidden for callcenter): a kanban-style board with one column per non-terminal
  stage plus a collapsed "المغلقة" section; each card links to the deal page. Board queries use
  `.in('stage_id', [...])` + `.order('updated_at')` + `.range()` per column (page size 25, "المزيد" button).

## 2. Commissions (commit: "CRM phase 6: commissions")

- Deal page commission card: shows base, rate, gross, VAT, shares, status, collected. For admin: an edit form
  (rate_percent, company_share, broker_share, external_share, external_party, collected_amount, invoice_no,
  notes, status only for `invoiced`/`waived` — the rest is derived). Live-compute the gross/VAT preview in the
  form from base × rate (display only; the DB is the source of truth after save).
- Route `#/commissions` (nav item "العمولات", admin only): table of all commissions with deal/client/broker,
  gross, collected, outstanding (= gross − collected), status; filters by status; totals row for the current page.
  `.range()` pagination.

## 3. Management dashboard (commit: "CRM phase 7: management dashboard")

Route `#/dashboard` (nav item "لوحة الإدارة", admin only):
- Top row of stat tiles from `v_my_work` (already used on #/work) plus totals from `v_funnel_monthly` current month:
  عملاء جدد, طلبات جديدة, مطابقات, معاينات, مفاوضات, صفقات تمت, عمولات (gross).
- Funnel for the current month as a simple horizontal bar list (no chart library): leads → requirements →
  matched → viewings → negotiations → won, with counts and conversion % between steps.
- Table "أداء الوسطاء" from `v_broker_performance` (all columns, sorted by won_90d desc then commission_gross_90d);
  no ranking medal or single "score" — show the columns as they are.
- Table "لماذا نخسر" from `v_lost_reasons_90d`.
- Table "آخر 12 شهراً" from `v_funnel_monthly`.
All numbers are already RLS-scoped; do not filter by user in the UI.

## Finish

Push and report commit hashes, the syntax/render check results, and what could not be verified.
