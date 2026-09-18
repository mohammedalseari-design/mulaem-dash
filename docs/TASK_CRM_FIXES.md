# Task: CRM fixes round 1 (after code review)

Context: `crm/` phases 2–4 are live. A code review found the items below. The database side has already been
updated live and is recorded in `supabase/migrations/006_inventory_quality.sql` (new) and in the notes below.
Same hard rules as `docs/TASK_CRM_UI.md`: do not touch the legacy dashboard files; everything under `crm/`;
`textContent`/`el()` only; server-side filtering with `.range()`; one commit per numbered group below, push at the end.

## 0. Commit the untracked files first

Commit `docs/TASK_CRM_UI.md`, `docs/TASK_CRM_FIXES.md`, `supabase/migrations/006_inventory_quality.sql` and
`scripts/migrate-images.ps1` with the message "Add inventory-quality migration, image migration script and task docs".
Note: `crm_staff()` (live migration `crm_staff_directory`) is already defined at the end of
`supabase/migrations/005_crm_core.sql`; do not create a separate file for it.

## 1. Data-loss and false-success bugs (commit: "CRM: fix silent unassign and false success on RLS-filtered updates")

- `crm/js/client-form.js`: when editing, a `<select>` whose current value is not among its options yields `''`
  and the form then sends `owner_id: null` / `source: null`, silently unassigning the client. Fix: always append
  the current value as an option when it is missing (same approach as `requirement-form.js` does for
  `property_type`), and send `owner_id` only when the user actually changed it.
- Every `.update(...).eq(...)` in `crm/js/matching.js`, `crm/js/followup-form.js`, `crm/js/client-form.js`,
  `crm/js/requirement-form.js`: add `.select('id')` and treat an empty result as failure with the message
  "لا تملك صلاحية تعديل هذا السجل" (RLS filtered the row). Never show "تم" when zero rows changed.
- `crm/js/matching.js` `unitFilter`: normalise `unit_key` `''` → `null` before insert, and filter updates with
  `.or('unit_key.is.null,unit_key.eq.')` so the unique index `coalesce(unit_key,'')` and the update agree.
- `crm/js/client-form.js` `showDuplicate`: only treat `23505` as a duplicate phone when `error.message`
  contains `clients_phone_uk`; otherwise show the generic error.

## 2. Vocabulary from the database, not from a 3000-row scan (commit: "CRM: vocabulary RPCs, Riyadh day bounds, boot guard")

Two new RPCs exist (security invoker, RLS applies):
- `crm_property_types()` → rows `{ property_type, units }` — unit-level types actually in stock, e.g. شقة, روف, فيلا.
  Use it for the requirement form's property-type select (this also fixes the 15 روف units that were unreachable).
- `crm_districts()` → rows `{ district, projects }` ordered by frequency. Use it for the districts checklist.
Replace `inventoryVocabulary` in `crm/js/data.js` with these two calls (`supabase.rpc('crm_property_types')`,
`supabase.rpc('crm_districts')`). If either fails, show the error and fall back to a free-text input, never block
the form.

Day boundaries: `v_my_work` now computes "today"/"overdue" in `Asia/Riyadh`. Change `crm/js/work.js` so both lists
use the same local-day bounds (build start/end of the current day in the browser's local time and send them as ISO
strings with offset), so the cards and the lists agree.

Boot guard: in `crm/index.html`, add a small classic (non-module) inline script before `js/app.js` that sets
`window.onerror` / `unhandledrejection` handlers writing a readable Arabic message into `#bootScreen`
("تعذّر تحميل الإعدادات أو المكتبة — راجع js/config.js") so a missing `MULAEM_CONFIG` or a CDN failure is never a
blank screen. Pin the supabase-js CDN to an exact 2.x version (same major as the dashboard uses).

## 3. Small hygiene (commit: "CRM: small fixes")

- `crm/js/ui.js` `el()`: refuse `innerHTML`, `outerHTML`, `srcdoc` keys (throw) so the helper can never be misused.
- `crm/js/ui.js` `errorText`: map common Postgres/PostgREST codes to Arabic: `42501` → "لا تملك صلاحية",
  `PGRST116` → "السجل غير موجود أو غير مرئي لك", `23503` → "مرجع غير صحيح", `22P02` → "قيمة غير صالحة".
- `crm/js/client.js`: if `staffMap()` fails, `notify` the error once instead of silently showing "مستخدم غير معروف".
- `crm/js/app.js`: do not run `route()` while the login screen is shown; if a session exists but has no
  `profiles` row, call `signOut()` so the legacy dashboard does not inherit a half-valid session.
- `crm/js/matching.js` `search()`: add `.limit(50)` to the RPC call for clarity (the function already caps at 50).

## Finish

Push, then report the commit hashes and anything you could not verify.
