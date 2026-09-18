# Task: CRM round 2 — Arabic digits, dashboard link, inventory-quality page, settings page

Same hard rules as `docs/TASK_CRM_UI.md` (everything under `crm/`, `el()`/`textContent` only, server-side filtering
with `.range()`, show Supabase errors in Arabic, `.select('id')` on every update). One exception is explicitly
allowed in group 2 below: a single link line in the legacy `index.html` header. One commit per group, push at the end.

## 1. Arabic and Persian digits everywhere numbers are typed (commit: "CRM: accept Arabic-Indic digits")

In `crm/js/ui.js` add `toAsciiDigits(text)` that maps Arabic-Indic `٠١٢٣٤٥٦٧٨٩` and Persian `۰۱۲۳۴۵۶۷۸۹` to `0-9`
and the Arabic decimal separator `٫` to `.`. Call it at the start of `parseNumber()`. Also apply it to the phone
fields in `client-form.js` before submit (the server normalizes the rest). In the requirement form, when
`budget_max` is present and below 50,000 for `purpose = 'sale'`, show an inline warning "هل تقصد بالريال؟ المبلغ
صغير جداً" but still allow saving. Number inputs of type `number` (area, rooms) must keep working with Arabic
keyboards: use `type="text"` + `inputMode="decimal"` + `parseNumber` for area fields too.

## 2. Link from the legacy dashboard to the CRM (commit: "Dashboard: link to CRM")

In the legacy `index.html`, add exactly one anchor in the header/navigation area, visible only after login (place it
next to the existing admin tabs or the user name; match existing markup/classes): `<a href="crm/" class="...">إدارة
العملاء</a>`. Do not touch `script.js`, the shim, or `style.css`. If the header is rendered by `script.js` and there
is no safe static place, put the link in the login-free footer area instead and say so in the commit body.

## 3. Admin page: inventory quality (commit: "CRM: inventory quality page")

New route `#/inventory` (nav item "جودة المخزون", admin only — hide the nav item for other roles; RLS already limits
what non-admins would see). Two sections, each a paginated table (`.range()`, page size 25):
- **عروض تحتاج انتباه** from view `v_inventory_attention`: columns id, name, type, district, price, employee,
  `issues` (text[] → render as small badges), listing_expires_at. Filter chips by issue text (client-side on the
  current page only is fine).
- **تكرار محتمل** from view `v_inventory_duplicates`: columns confidence (badge: عالية/متوسطة/منخفضة), name,
  duplicate_name, reason. Order by confidence.
Rows link nowhere (the legacy dashboard has no deep links); show the project id so the admin can find it there.

## 4. Admin page: settings (commit: "CRM: settings page")

New route `#/settings` (nav item "الإعدادات", admin only). Reads `crm_settings` rows `match_weights` (jsonb with
district, budget, area, rooms, delivery) and `default_city` (jsonb string). Form with five numeric weights (show the
sum, warn if it is not 100 but allow), and a text field for the default city. Save with `upsert` on `key`
(`onConflict: 'key'`) and `.select('key')`; show the Supabase error if RLS refuses (non-admin). Add a note under the
weights: "التغيير يؤثر على نتائج المطابقة فوراً ولا يحتاج نشراً".

## Finish

Push and report the commit hashes and what you could not verify (there is no JS runtime on this machine).
